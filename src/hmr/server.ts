import { join, relative } from "node:path";
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
	getRoutePathnameFromFileChange,
	resolveWatchDirectories,
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
};

export type HmrServer = {
	setBuilder: (builder: Builder) => void;
	getCurrentDevRoute: () => DevBuildTarget | null;
	clearSelectiveRoute: () => void;
	getRoutesForBuild: () => Record<string, string>;
	requestDevRouteBuild: (pathname: string) => Promise<DevRouteBuildResponse>;
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

	const log = (...args: unknown[]) => {
		if (debug || process.env.DEBUG_APPLY_REACT === "1") {
			console.log("[Apply-React HMR]", ...args);
		}
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
			if (matched) names.add(matched.name);
		}
		if (currentDevRoute) names.add(currentDevRoute.matchedRoute.name);
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
		pendingFsPaths.add(absolutePath);
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			flushFs();
		}, debounceMs);
	};

	const classifyAndHandle = (absolutePath: string) => {
		log("file change", absolutePath);
		const classified = classifyWatchPath(
			cwd,
			routeDir,
			absolutePath,
			runtimePaths,
		);

		switch (classified.kind) {
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
					// try raw pathname from file
					const alt = getRoutePathnameFromFileChange(
						cwd,
						routeDir,
						absolutePath,
					);
					const m2 = alt ? fileRouter.match(alt) : null;
					if (!m2) return;
					queueTargets([{ matchedRoute: m2, pathname: m2.pathname }]);
					return;
				}
				queueTargets([
					{ matchedRoute: matched, pathname: matched.pathname },
				]);
				return;
			}
			case "layout":
			case "loading":
			case "not-found": {
				// Rebuild all active client routes (layouts wrap them)
				const targets: DevBuildTarget[] = [];
				const names = activeRouteNames();
				if (names.size === 0) {
					// rebuild all page routes (not specials)
					for (const [name, fp] of Object.entries(fileRouter.routes)) {
						if (
							name.endsWith("layout") ||
							name.endsWith("loading") ||
							name.endsWith("404")
						) {
							continue;
						}
						const t = matchRouteByName(name);
						if (t) targets.push(t);
					}
				} else {
					for (const name of names) {
						const t = matchRouteByName(name);
						if (t) targets.push(t);
					}
				}
				queueTargets(targets);
				return;
			}
			case "shared": {
				const abs = absolutePath;
				const routeNames = depIndex.get(abs);
				if (!routeNames || routeNames.size === 0) {
					// unknown shared — rebuild active routes as safe default
					const targets: DevBuildTarget[] = [];
					for (const name of activeRouteNames()) {
						const t = matchRouteByName(name);
						if (t) targets.push(t);
					}
					if (targets.length) queueTargets(targets);
					return;
				}
				const targets: DevBuildTarget[] = [];
				for (const name of routeNames) {
					const t = matchRouteByName(name);
					if (t) targets.push(t);
				}
				queueTargets(targets);
				return;
			}
			default:
				return;
		}
	};

	const handleAfterBuild = () => {
		if (!pendingRouteUpdate) return;
		const target = pendingRouteUpdate;
		pendingRouteUpdate = null;
		broadcast(
			envelope({
				type: "update-routes",
				route: buildRouteUpdatePath(target),
				pathname: target.pathname,
				routeName: target.matchedRoute.name,
			}),
		);
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
