import { join, relative, resolve } from "node:path";
import type { Builder } from "frame-master/build";
import {
	type DevRouteBuildResponse,
	errorToPayload,
	HMR_PROTOCOL_VERSION,
	type HMRClientMessage,
	type HMRServerMessage,
	parseHmrMessage,
} from "./protocol";
import { type DevBuildTarget, DevBuildQueue } from "./queue";
import { buildRouteDependencyIndex } from "./deps";
import {
	classifyWatchPath,
	filePathToPathname,
	getRoutePathnameFromFileChange,
	isSpecialRouteName,
	resolveWatchDirectories,
	shouldIgnoreWatchPath,
} from "./watch";

export type HmrClientState = {
	ws: Bun.ServerWebSocket<unknown>;
	pathname: string;
	tabId: string;
};

export type CreateHmrServerOptions = {
	cwd: string;
	route: string;
	routeDir: string;
	enableHMR: boolean;
	fileRouter: Bun.FileSystemRouter;
	watchDirectories?: string[];
	watchDirectoriesExclude?: string[];
	runtimePaths?: string[];
	debounceMs?: number;
	debug?: boolean;
	/** Absolute module root for per-file graph */
	moduleRootAbs?: string;
	/**
	 * When true, FS changes under moduleRoot rebuild the multi-entrypoint graph
	 * then emit invalidate-module (cache-bust built artifacts).
	 */
	perFileGraph?: boolean;
};

export type HmrServer = {
	setBuilder: (builder: Builder) => void;
	getCurrentDevRoute: () => DevBuildTarget | null;
	clearSelectiveRoute: () => void;
	getRoutesForBuild: () => Record<string, string>;
	requestDevRouteBuild: (pathname: string) => Promise<DevRouteBuildResponse>;
	/** Kick a full per-file graph rebuild (e.g. missing mod artifact). */
	requestModGraphRebuild: (reason?: string) => void;
	onFileSystemChange: (absolutePath: string) => void;
	handleAfterBuild: () => void;
	onSocketOpen: (ws: Bun.ServerWebSocket<unknown>) => void;
	onSocketClose: (ws: Bun.ServerWebSocket<unknown>) => void;
	onSocketMessage: (ws: Bun.ServerWebSocket<unknown>, message: string | Buffer) => void;
	watchDirs: string[];
	/** Test/helpers */
	getGeneration: () => number;
	getClients: () => HmrClientState[];
	refreshDependencyIndex: () => Promise<void>;
	classifyAndHandle: (absolutePath: string) => void;
};

export function createHmrServer(options: CreateHmrServerOptions): HmrServer {
	const {
		cwd,
		route,
		routeDir,
		enableHMR,
		fileRouter,
		watchDirectories,
		watchDirectoriesExclude,
		runtimePaths = [],
		debounceMs = 75,
		debug = false,
		moduleRootAbs,
		perFileGraph = false,
	} = options;

	const queue = new DevBuildQueue();
	const clients = new Map<Bun.ServerWebSocket<unknown>, HmrClientState>();
	let liveBuilder: Builder | null = null;
	let currentDevRoute: DevBuildTarget | null = null;
	let pendingRouteUpdate: DevBuildTarget | null = null;
	let selectiveBuildPromise: Promise<void> | null = null;
	let generation = 0;
	let depIndex = new Map<string, Set<string>>();
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const pendingFsPaths = new Set<string>();
	/** Suppress FS-driven rebuilds briefly after our own build writes outputs. */
	let ignoreFsUntil = 0;
	/**
	 * Shell modules (layout/loading/404) to notify after page rebuilds finish.
	 * Key = route name (`/layout`), value = built js path relative to routes dir.
	 */
	const pendingShellNotifies = new Map<string, string>();
	/**
	 * Per-file graph: moduleRoot-relative paths to invalidate after a successful rebuild.
	 * Empty set + rebuildRequested → rebuild without client invalidate (e.g. missing artifact).
	 */
	const pendingModuleInvalidations = new Set<string>();
	let modGraphRebuildPromise: Promise<void> | null = null;
	let modGraphRebuildQueued = false;

	const log = (...args: unknown[]) => {
		if (debug || process.env.DEBUG_APPLY_REACT === "1") {
			console.log("[Apply-React HMR]", ...args);
		}
	};

	const isPageRouteName = (name: string) => !isSpecialRouteName(name);

	/** Collect navigable page routes only (never layout/loading/404 as build targets). */
	const allPageRouteNames = (): string[] =>
		Object.keys(fileRouter.routes).filter(isPageRouteName);

	const expandRouteNamesToPageTargets = (
		routeNames: Iterable<string>,
	): DevBuildTarget[] => {
		const pageNames = new Set<string>();
		let sawSpecial = false;

		for (const name of routeNames) {
			if (isSpecialRouteName(name)) {
				sawSpecial = true;
				continue;
			}
			pageNames.add(name);
		}

		// Dep imported only by layout/loading/404 → rebuild pages that use those shells
		if (sawSpecial) {
			const active = activeRouteNames();
			if (active.size > 0) {
				for (const name of active) {
					if (isPageRouteName(name)) pageNames.add(name);
				}
			} else {
				for (const name of allPageRouteNames()) pageNames.add(name);
			}
		}

		const targets: DevBuildTarget[] = [];
		for (const name of pageNames) {
			const t = matchRouteByName(name);
			if (t) targets.push(t);
		}
		return targets;
	};

	const send = (
		ws: Bun.ServerWebSocket<unknown>,
		message: HMRServerMessage,
	) => {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			clients.delete(ws);
		}
	};

	const broadcast = (message: HMRServerMessage) => {
		for (const [ws] of clients) {
			send(ws, message);
		}
	};

	const nextGeneration = () => {
		generation += 1;
		return generation;
	};

	const envelope = <T extends Omit<HMRServerMessage, "v" | "generation">>(
		msg: T,
		gen = generation,
	): HMRServerMessage =>
		({
			v: HMR_PROTOCOL_VERSION,
			generation: gen,
			...msg,
		}) as HMRServerMessage;

	const activeRouteNames = (): Set<string> => {
		const names = new Set<string>();
		for (const client of clients.values()) {
			const matched = fileRouter.match(client.pathname);
			if (matched && isPageRouteName(matched.name)) names.add(matched.name);
		}
		if (
			currentDevRoute &&
			isPageRouteName(currentDevRoute.matchedRoute.name)
		) {
			names.add(currentDevRoute.matchedRoute.name);
		}
		return names;
	};

	const getRoutesForBuild = (): Record<string, string> => {
		const active = activeRouteNames();
		if (active.size === 0) {
			// No clients yet — if selective target, use it; else full map
			if (currentDevRoute) {
				return {
					[currentDevRoute.matchedRoute.name]:
						currentDevRoute.matchedRoute.filePath,
				};
			}
			return fileRouter.routes;
		}
		const subset: Record<string, string> = {};
		for (const name of active) {
			const fp = fileRouter.routes[name];
			if (fp) subset[name] = fp;
		}
		// Always include layouts/loading/404 special routes that exist
		for (const [name, fp] of Object.entries(fileRouter.routes)) {
			if (
				name.endsWith("/layout") ||
				name.endsWith("layout") ||
				name.endsWith("/loading") ||
				name.endsWith("loading") ||
				name.endsWith("/404") ||
				name.endsWith("404")
			) {
				subset[name] = fp;
			}
		}
		return Object.keys(subset).length > 0 ? subset : fileRouter.routes;
	};

	const buildRouteUpdatePath = (target: DevBuildTarget) =>
		target.matchedRoute.src.replace(/\.(tsx|jsx)$/, ".js");

	const matchRouteByName = (routeName: string): DevBuildTarget | null => {
		const filePath = fileRouter.routes[routeName];
		if (!filePath) return null;
		// Prefer matching via a concrete pathname if possible
		const matched = fileRouter.match(
			routeName.includes("[")
				? routeName.replace(/\[([^\]]+)\]/g, "_")
				: routeName,
		);
		if (matched && matched.name === routeName) {
			return { matchedRoute: matched, pathname: matched.pathname };
		}
		// Synthetic match from routes map
		const synthetic = {
			name: routeName,
			pathname: routeName.replace(/\[.*?\]/g, "0"),
			filePath,
			src: relative(join(cwd, route), filePath).replace(/\\/g, "/"),
		} as unknown as Bun.MatchedRoute;
		return {
			matchedRoute: synthetic,
			pathname: synthetic.pathname,
		};
	};

	const queueTargets = (targets: DevBuildTarget[]) => {
		for (const t of targets) {
			queue.enqueue(t);
		}
		if (queue.isEmpty && pendingShellNotifies.size > 0) {
			// Layout-only project edge case: no page targets — still rebuild shells
			void (async () => {
				const builder = liveBuilder;
				if (!builder) {
					flushShellNotifies();
					return;
				}
				try {
					currentDevRoute = null;
					pendingRouteUpdate = null;
					const gen = nextGeneration();
					broadcast(
						envelope(
							{
								type: "route-build-started",
								pathname: "/",
								routeName: "/",
							},
							gen,
						),
					);
					await builder.build();
				} catch (error) {
					broadcast(
						envelope({
							type: "build-failed",
							error: errorToPayload(error),
						}),
					);
				} finally {
					ignoreFsUntil = Date.now() + Math.max(debounceMs * 4, 400);
					flushShellNotifies();
				}
			})();
			return;
		}
		void runQueuedDevBuilds();
	};

	const runQueuedDevBuilds = async () => {
		const builder = liveBuilder;
		if (!builder || selectiveBuildPromise) return selectiveBuildPromise;

		selectiveBuildPromise = (async () => {
			while (!queue.isEmpty) {
				const nextRoute = queue.shift();
				if (!nextRoute) break;

				const activeBuild = builder.awaitBuildFinish();
				if (builder.isBuilding() && activeBuild) {
					await activeBuild;
				}

				currentDevRoute = nextRoute;
				pendingRouteUpdate = nextRoute;
				const gen = nextGeneration();
				broadcast(
					envelope(
						{
							type: "route-build-started",
							pathname: nextRoute.pathname,
							routeName: nextRoute.matchedRoute.name,
						},
						gen,
					),
				);

				try {
					const result = await builder.build();
					if (result && "success" in result && result.success === false) {
						const msg =
							// @ts-expect-error bun build logs shape varies
							result.logs?.[0]?.message ?? "Build failed";
						pendingRouteUpdate = null;
						broadcast(
							envelope(
								{
									type: "build-failed",
									pathname: nextRoute.pathname,
									routeName: nextRoute.matchedRoute.name,
									error: { message: String(msg) },
								},
								gen,
							),
						);
					}
				} catch (error) {
					pendingRouteUpdate = null;
					broadcast(
						envelope(
							{
								type: "build-failed",
								pathname: nextRoute.pathname,
								routeName: nextRoute.matchedRoute.name,
								error: errorToPayload(error),
							},
							gen,
						),
					);
					log("build error", error);
				}
			}
		})()
			.catch((error) => {
				console.error("[Apply-React HMR] Failed to run queued dev build", error);
				broadcast(
					envelope({
						type: "build-failed",
						error: errorToPayload(error),
					}),
				);
			})
			.finally(() => {
				selectiveBuildPromise = null;
				if (!queue.isEmpty) {
					void runQueuedDevBuilds();
				}
			});

		return selectiveBuildPromise;
	};

	const requestDevRouteBuild = async (
		pathname: string,
	): Promise<DevRouteBuildResponse> => {
		const matchedRoute = fileRouter.match(pathname);
		if (!matchedRoute) {
			const gen = generation;
			broadcast(
				envelope({
					type: "route-build-missing",
					pathname,
				}),
			);
			return { status: "missing", pathname, generation: gen };
		}

		const target: DevBuildTarget = {
			matchedRoute,
			pathname: matchedRoute.pathname,
		};
		const gen = nextGeneration();
		broadcast(
			envelope(
				{
					type: "route-build-started",
					pathname: target.pathname,
					routeName: target.matchedRoute.name,
				},
				gen,
			),
		);
		queue.enqueue(target);
		void runQueuedDevBuilds();

		return {
			status: "building",
			pathname: target.pathname,
			routeName: target.matchedRoute.name,
			generation: gen,
		};
	};

	const flushFs = () => {
		const paths = [...pendingFsPaths];
		pendingFsPaths.clear();
		for (const absolutePath of paths) {
			classifyAndHandle(absolutePath);
		}
	};

	const onFileSystemChange = (absolutePath: string) => {
		if (!enableHMR) return;
		if (Date.now() < ignoreFsUntil) return;
		if (shouldIgnoreWatchPath(cwd, absolutePath)) return;
		pendingFsPaths.add(absolutePath);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			flushFs();
		}, debounceMs);
	};

	const flushModuleInvalidations = (success: boolean) => {
		if (!success) {
			pendingModuleInvalidations.clear();
			return;
		}
		if (pendingModuleInvalidations.size === 0) return;
		const paths = [...pendingModuleInvalidations];
		pendingModuleInvalidations.clear();
		const t = Date.now();
		const gen = nextGeneration();
		for (const rel of paths) {
			log("invalidate-module after rebuild", rel);
			broadcast(
				envelope(
					{
						type: "invalidate-module",
						path: rel,
						t,
					},
					gen,
				),
			);
		}
	};

	const runModGraphRebuild = async () => {
		const builder = liveBuilder;
		if (!builder) {
			pendingModuleInvalidations.clear();
			modGraphRebuildQueued = false;
			return;
		}
		if (modGraphRebuildPromise) {
			modGraphRebuildQueued = true;
			return modGraphRebuildPromise;
		}

		modGraphRebuildPromise = (async () => {
			do {
				modGraphRebuildQueued = false;
				const activeBuild = builder.awaitBuildFinish();
				if (builder.isBuilding() && activeBuild) {
					await activeBuild;
				}
				const gen = nextGeneration();
				broadcast(
					envelope(
						{
							type: "route-build-started",
							pathname: "/",
							routeName: "/@apply-react/mod",
						},
						gen,
					),
				);
				let success = true;
				try {
					log("per-file graph rebuild", {
						pendingInvalidations: pendingModuleInvalidations.size,
					});
					const result = await builder.build();
					if (result && "success" in result && result.success === false) {
						success = false;
						const msg =
							// @ts-expect-error bun build logs shape varies
							result.logs?.[0]?.message ?? "Build failed";
						broadcast(
							envelope(
								{
									type: "build-failed",
									pathname: "/",
									routeName: "/@apply-react/mod",
									error: { message: String(msg) },
								},
								gen,
							),
						);
					}
				} catch (error) {
					success = false;
					broadcast(
						envelope(
							{
								type: "build-failed",
								pathname: "/",
								routeName: "/@apply-react/mod",
								error: errorToPayload(error),
							},
							gen,
						),
					);
				} finally {
					ignoreFsUntil = Date.now() + Math.max(debounceMs * 4, 400);
				}
				// afterBuild hook also runs via plugin; flush invalidations here so
				// we still notify even if afterBuild path differs.
				flushModuleInvalidations(success);
			} while (modGraphRebuildQueued);
		})().finally(() => {
			modGraphRebuildPromise = null;
		});

		return modGraphRebuildPromise;
	};

	const requestModGraphRebuild = (reason?: string) => {
		if (!perFileGraph) return;
		log("requestModGraphRebuild", reason ?? "");
		void runModGraphRebuild();
	};

	const classifyAndHandle = (absolutePath: string) => {
		if (shouldIgnoreWatchPath(cwd, absolutePath)) return;
		log("file change", absolutePath);

		// Per-file graph: rebuild entrypoints, then invalidate changed module URLs
		if (
			perFileGraph &&
			moduleRootAbs &&
			resolve(absolutePath).startsWith(moduleRootAbs)
		) {
			const classifiedEarly = classifyWatchPath(
				cwd,
				routeDir,
				absolutePath,
				runtimePaths,
			);
			if (classifiedEarly.kind === "runtime") {
				broadcast(
					envelope({
						type: "full-reload",
						reason: `Runtime module changed: ${absolutePath}`,
					}),
				);
				return;
			}
			if (classifiedEarly.kind === "ignored") return;

			const rel = relative(moduleRootAbs, resolve(absolutePath)).replace(
				/\\/g,
				"/",
			);
			if (!rel || rel.startsWith("..")) return;
			pendingModuleInvalidations.add(rel);
			void runModGraphRebuild();
			return;
		}

		const classified = classifyWatchPath(
			cwd,
			routeDir,
			absolutePath,
			runtimePaths,
		);

		switch (classified.kind) {
			case "ignored":
				return;
			case "runtime": {
				broadcast(
					envelope({
						type: "full-reload",
						reason: `Runtime module changed: ${absolutePath}`,
					}),
				);
				return;
			}
			case "page": {
				if (!classified.pagePathname) return;
				const matched = fileRouter.match(classified.pagePathname);
				if (!matched) {
					const alt = getRoutePathnameFromFileChange(
						cwd,
						routeDir,
						absolutePath,
					);
					const m2 = alt ? fileRouter.match(alt) : null;
					if (!m2 || isSpecialRouteName(m2.name)) return;
					queueTargets([{ matchedRoute: m2, pathname: m2.pathname }]);
					return;
				}
				if (isSpecialRouteName(matched.name)) return;
				queueTargets([
					{ matchedRoute: matched, pathname: matched.pathname },
				]);
				return;
			}
			case "layout":
			case "loading":
			case "not-found": {
				// Rebuild pages that use the shell, then notify client with a
				// cache-busted shell module (layout itself is not a navigable page).
				const rel = classified.routeRelativePath;
				if (rel) {
					const shellRouteName = filePathToPathname(rel);
					const shellJs = rel.replace(/\.(tsx|jsx|ts|js)$/i, ".js");
					pendingShellNotifies.set(shellRouteName, shellJs);
					queueTargets(expandRouteNamesToPageTargets([shellRouteName]));
				} else {
					queueTargets(expandRouteNamesToPageTargets(activeRouteNames()));
				}
				return;
			}
			case "shared": {
				const abs = resolve(cwd, absolutePath);
				const routeNames = depIndex.get(abs);
				if (!routeNames || routeNames.size === 0) {
					// Unknown shared module: rebuild active pages only (once)
					queueTargets(expandRouteNamesToPageTargets(activeRouteNames()));
					return;
				}
				// Expand layout-only importers to real pages (fixes layout-dep loops)
				queueTargets(expandRouteNamesToPageTargets(routeNames));
				return;
			}
			default:
				return;
		}
	};

	const flushShellNotifies = () => {
		if (pendingShellNotifies.size === 0) return;
		const gen = generation;
		for (const [routeName, routeJs] of pendingShellNotifies) {
			log("notify shell update", routeName, routeJs);
			broadcast(
				envelope(
					{
						type: "update-routes",
						route: routeJs,
						pathname: routeName,
						routeName,
					},
					gen,
				),
			);
		}
		pendingShellNotifies.clear();
	};

	const handleAfterBuild = () => {
		// Build may write under .frame-master — ignore those FS events briefly
		ignoreFsUntil = Date.now() + Math.max(debounceMs * 4, 400);
		// Per-file: invalidations are flushed inside runModGraphRebuild after success.
		// If a full build completed outside that path with pending paths, flush here.
		if (perFileGraph && pendingModuleInvalidations.size > 0 && !modGraphRebuildPromise) {
			flushModuleInvalidations(true);
		}
		if (pendingRouteUpdate) {
			const target = pendingRouteUpdate;
			pendingRouteUpdate = null;
			// Page module update (never treat layout/loading/404 as the page)
			if (!isSpecialRouteName(target.matchedRoute.name)) {
				broadcast(
					envelope({
						type: "update-routes",
						route: buildRouteUpdatePath(target),
						pathname: target.pathname,
						routeName: target.matchedRoute.name,
					}),
				);
			}
		}
		// After the selective rebuild queue drains, push shell (layout) updates
		// so the client cache-busts layout importers and remounts the tree.
		if (queue.isEmpty) {
			flushShellNotifies();
		}
	};

	const refreshDependencyIndex = async () => {
		depIndex = await buildRouteDependencyIndex(fileRouter.routes, cwd);
	};

	const watchDirs = enableHMR
		? resolveWatchDirectories(cwd, watchDirectories, watchDirectoriesExclude)
		: [];

	return {
		setBuilder(builder) {
			liveBuilder = builder;
			void refreshDependencyIndex();
		},
		getCurrentDevRoute: () => currentDevRoute,
		clearSelectiveRoute() {
			currentDevRoute = null;
			queue.clear();
			pendingRouteUpdate = null;
		},
		getRoutesForBuild,
		requestDevRouteBuild,
		requestModGraphRebuild,
		onFileSystemChange,
		handleAfterBuild,
		onSocketOpen(ws) {
			clients.set(ws, {
				ws,
				pathname: "/",
				tabId: crypto.randomUUID(),
			});
			send(
				ws,
				envelope({
					type: "server-hello",
				}),
			);
		},
		onSocketClose(ws) {
			clients.delete(ws);
		},
		onSocketMessage(ws, message) {
			const text =
				typeof message === "string" ? message : new TextDecoder().decode(message);
			const parsed = parseHmrMessage(text) as HMRClientMessage | null;
			if (!parsed) return;

			if (parsed.type === "client-hello") {
				const state = clients.get(ws);
				if (state) {
					state.pathname = parsed.pathname;
					state.tabId = parsed.tabId;
				} else {
					clients.set(ws, {
						ws,
						pathname: parsed.pathname,
						tabId: parsed.tabId,
					});
				}
				return;
			}
			if (parsed.type === "ping") {
				send(ws, envelope({ type: "pong" }));
			}
		},
		watchDirs,
		getGeneration: () => generation,
		getClients: () => [...clients.values()],
		refreshDependencyIndex,
		classifyAndHandle,
	};
}

export { getRoutePathnameFromFileChange } from "./watch";
