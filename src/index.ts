import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Builder } from "frame-master/build";
import {
	type FrameMasterPlugin,
	getChainableContent,
} from "frame-master/plugin";
import { directiveManager, isProd } from "frame-master/utils";
import { name, peerDependencies, version } from "../package.json";
import { transformReactRefreshModule } from "./react-refresh-transform";

const TRACKED_SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".json",
	".css",
	".scss",
	".sass",
	".less",
]);

const NON_RECURSIVE_EXTENSIONS = new Set([
	".json",
	".css",
	".scss",
	".sass",
	".less",
]);

const DevReactEntryPoints = [
	"react",
	"react-dom",
	"node_modules/react/cjs/react-jsx-dev-runtime.development.js",
	"node_modules/react/jsx-dev-runtime.js",
	"node_modules/react/cjs/react.development.js",
	"node_modules/react-dom/cjs/react-dom.development.js",
] as const;

const VirtualModules = [
	"@apply-react/client-routes.ts",
	"@apply-react/client-hydrate.tsx",
	"@apply-react/HMR.ts",
	"@apply-react/react-refresh-runtime.ts",
	"@apply-react/client-shell.tsx",
	"@apply-react/404.tsx",
	"@apply-react/loading.tsx",
	"@apply-react/fast-refresh-enabled.ts",
	"@apply-react/hmr-websocket-protocol.ts",
	"@apply-react/development-mode.ts",
] as const;

const IMPORT_SPECIFIER_PATTERNS = [
	/(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g,
	/import\s*["']([^"']+)["']/g,
	/import\s*\(\s*["']([^"']+)["']\s*\)/g,
	/require\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/**
 * Bun chunk filename pattern for apply-react builds.
 * Always include a per-build stamp so HMR rebuilds never reuse a previous
 * content-hash URL (reverting source would otherwise skip ESM re-eval and
 * leave Fast Refresh with a stale component type).
 */
export function resolveChunkNamingPattern(
	buildStamp: number = Date.now(),
): string {
	return `chunk-[hash]-${buildStamp}.[ext]`;
}

/**
 * Cache-bust only the changed route's page chunk. Shared chunks intentionally
 * keep stable URLs so React and React Refresh remain singletons in the page.
 */
export function cacheBustRoutePageChunk(source: string, buildStamp: number) {
	return source.replace(
		/(from\s+["'][^"']*chunk-[^"']+\.js)(["'])/,
		`$1?t=${buildStamp}$2`,
	);
}

export function extractImportSpecifiers(source: string): string[] {
	const specifiers = new Set<string>();

	for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
		for (const match of source.matchAll(pattern)) {
			const specifier = match[1]?.trim();
			if (!specifier) continue;
			specifiers.add(specifier);
		}
	}

	return [...specifiers];
}

function normalizeWatchedFilePath(projectRoot: string, filePath: string) {
	return resolve(projectRoot, filePath);
}

function isWithinProject(projectRoot: string, filePath: string) {
	const relativePath = relative(projectRoot, filePath);
	return (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!isAbsolute(relativePath)
	);
}

function isIgnoredForDependencyTracking(projectRoot: string, filePath: string) {
	if (!isWithinProject(projectRoot, filePath)) return true;
	const relativePath = relative(projectRoot, filePath);
	return (
		relativePath.startsWith(".git/") ||
		relativePath.startsWith(".frame-master/") ||
		relativePath.startsWith("release-notes/")
	);
}

function resolveWithKnownExtensions(candidatePath: string) {
	if (existsSync(candidatePath)) return candidatePath;

	for (const extension of TRACKED_SOURCE_EXTENSIONS) {
		const withExtension = `${candidatePath}${extension}`;
		if (existsSync(withExtension)) return withExtension;
	}

	for (const extension of TRACKED_SOURCE_EXTENSIONS) {
		const asIndex = join(candidatePath, `index${extension}`);
		if (existsSync(asIndex)) return asIndex;
	}

	return null;
}

function getBunLoader(filePath: string) {
	switch (extname(filePath)) {
		case ".tsx":
			return "tsx" as const;
		case ".jsx":
			return "jsx" as const;
		case ".ts":
		case ".mts":
		case ".cts":
			return "ts" as const;
		default:
			return "js" as const;
	}
}

export function shouldTransformReactRefreshModule(
	projectRoot: string,
	filePath: string,
) {
	if (!isWithinProject(projectRoot, filePath)) return false;

	const relativePath = relative(projectRoot, filePath);
	if (relativePath.split(/[\\/]/).includes("node_modules")) return false;

	const extension = extname(filePath);
	return (
		TRACKED_SOURCE_EXTENSIONS.has(extension) &&
		!NON_RECURSIVE_EXTENSIONS.has(extension)
	);
}

export function resolveFastRefreshEnabled(
	enableHMR: boolean,
	enableFastRefresh: boolean | undefined,
) {
	return enableHMR && (enableFastRefresh ?? enableHMR);
}

export type HmrWebsocketProtocol = "ws" | "wss" | "auto";

export function resolveHmrWebsocketProtocol(
	websocket: HmrWebsocketProtocol | undefined,
): HmrWebsocketProtocol {
	if (websocket === "ws" || websocket === "wss" || websocket === "auto") {
		return websocket;
	}
	return "auto";
}

function resolveImportSpecifier(
	sourceFilePath: string,
	specifier: string,
	projectRoot: string,
) {
	if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
		return null;
	}

	if (specifier.startsWith(".") || specifier.startsWith("/")) {
		const fromSource = specifier.startsWith("/")
			? resolve(projectRoot, `.${specifier}`)
			: resolve(join(sourceFilePath, ".."), specifier);
		return resolveWithKnownExtensions(fromSource);
	}

	try {
		const resolvedUrl = import.meta.resolve(
			specifier,
			pathToFileURL(sourceFilePath).href,
		);
		if (!resolvedUrl.startsWith("file:")) return null;
		return resolveWithKnownExtensions(fileURLToPath(resolvedUrl));
	} catch {
		return null;
	}
}

async function collectFileDependencies(
	entryFilePath: string,
	projectRoot: string,
) {
	const stack = [entryFilePath];
	const discovered = new Set<string>();

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		const normalizedCurrent = normalizeWatchedFilePath(projectRoot, current);

		if (discovered.has(normalizedCurrent)) continue;
		if (isIgnoredForDependencyTracking(projectRoot, normalizedCurrent))
			continue;

		discovered.add(normalizedCurrent);

		if (!existsSync(normalizedCurrent)) continue;
		const extension = extname(normalizedCurrent);
		if (!TRACKED_SOURCE_EXTENSIONS.has(extension)) continue;
		if (NON_RECURSIVE_EXTENSIONS.has(extension)) continue;

		let source: string;
		try {
			source = await readFile(normalizedCurrent, "utf8");
		} catch {
			continue;
		}

		const specifiers = extractImportSpecifiers(source);
		for (const specifier of specifiers) {
			const resolvedDependency = resolveImportSpecifier(
				normalizedCurrent,
				specifier,
				projectRoot,
			);
			if (!resolvedDependency) continue;
			if (isIgnoredForDependencyTracking(projectRoot, resolvedDependency))
				continue;
			stack.push(resolvedDependency);
		}
	}

	return discovered;
}

const reactDedupePlugin: Bun.BunPlugin = {
	name: "react-dedupe",
	setup(build) {
		const appNodeModules = resolve(process.cwd(), "./node_modules");
		build.onResolve({ filter: /^react$/ }, () => ({
			path: resolve(appNodeModules, "react/index.js"),
		}));
		build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
			path: resolve(appNodeModules, "react/jsx-runtime.js"),
		}));
	},
};

/**
 * Configuration options for the Apply-React plugin
 */
export type ApplyReactPluginOptions = {
	/** Routing style convention (currently supports "nextjs") */
	style: "nextjs";

	/** Base path to the routes directory (e.g., "src/pages") */
	route: string;

	/**
	 * Optional path to a custom client-side shell component
	 *
	 * Used as a wrapper for the RouterHost or global shell during hydration.
	 * If not provided, the default client shell will be used.
	 */
	clientShellPath?: string;

	/**
	 * Enable Hot Module Replacement for development
	 *
	 * @default true
	 */
	enableHMR?: boolean;

	/**
	 * Client HMR transport options.
	 */
	HMROptions?: {
		/**
		 * WebSocket scheme used by the browser HMR client.
		 *
		 * - `"ws"` — always `ws://` (local http)
		 * - `"wss"` — always `wss://` (HTTPS reverse proxies / tunnels)
		 * - `"auto"` — `wss` when `location.protocol === "https:"`, else `ws`
		 *
		 * Use `"wss"` or `"auto"` behind HTTPS tunnels (e.g. Cloudflare) so mixed
		 * content does not block the HMR socket.
		 *
		 * @default "auto"
		 */
		websocket?: "ws" | "wss" | "auto";
	};

	/**
	 * Enable React Fast Refresh during development HMR updates.
	 *
	 * When enabled, compatible component and provider state is retained and
	 * top-level exported React contexts preserve their identity across updates.
	 *
	 * @default Same value as `enableHMR`
	 */
	enableFastRefresh?: boolean;

	/**
	 * Directories to watch for HMR file changes.
	 *
	 * Relative paths are resolved from the project root.
	 *
	 * @default [".", "node_modules"]
	 */
	watchDirectories?: string[];

	/**
	 * Directories to exclude from HMR watching.
	 *
	 * Excludes are applied after `watchDirectories`, so exclusions always win.
	 * Relative paths are resolved from the project root.
	 */
	watchDirectoriesExclude?: string[];

	/**
	 * Hydration method to use on the client
	 *
	 * - `"hydrate"`: Attaches event listeners to existing server-rendered HTML (default)
	 * - `"render"`: Fully re-renders the component tree on the client ( not supported yet )
	 *
	 * @default "hydrate"
	 */
	hydration?: "hydrate" | "render";

	/**
	 * Set Custom entrypoints extensions
	 *
	 * @default [".tsx", ".jsx"]
	 */
	entrypointExtensions?: string[];

	/**
	 * default fallbacks pages
	 */
	fallbacks?: Partial<{
		/**
		 * Path to a custom 404 Not Found component to render when a route is not found or when a component throws a NotFoundError. This component will be used as a fallback for any route that does not have a specific 404 component defined at the same level in the file system.
		 */
		defaultNotFoundComponentPath?: string;
		/**
		 * Path to a custom Loading component to display during client-side page transitions while the route module is being imported. This component will be used as a fallback for any route that does not have a specific loading component defined at the same level in the file system.
		 */
		defaultLoadingComponentPath?: string;
	}>;
};

export function resolveWatchDirectories(
	enableHMR: boolean,
	watchDirectories?: string[],
	watchDirectoriesExclude?: string[],
) {
	if (!enableHMR) return undefined;
	const includeDirectories = watchDirectories ?? [".", "node_modules"];

	const cleanedDirectories = includeDirectories
		.map((directory) => directory.trim())
		.filter((directory) => directory.length > 0);

	const uniqueDirectories = [...new Set(cleanedDirectories)];
	if (uniqueDirectories.length === 0) return undefined;

	if (!watchDirectoriesExclude || watchDirectoriesExclude.length === 0) {
		return uniqueDirectories;
	}

	const excludedDirectories = new Set(
		watchDirectoriesExclude
			.map((directory) => directory.trim())
			.filter((directory) => directory.length > 0),
	);

	const resolvedDirectories = uniqueDirectories.filter(
		(directory) => !excludedDirectories.has(directory),
	);

	if (resolvedDirectories.length === 0) return undefined;
	return resolvedDirectories;
}

/**
 * Apply React Plugin for Frame Master
 *
 * Enables React support with client-side hydration.
 *
 * **use with frame-master-plugin-react-to-html** for full SSR.
 *
 * @features
 * - Server-side rendering (SSR) of React components
 * - Client-side hydration for interactive components
 * - File-based routing with automatic route generation
 * - Hot Module Replacement (HMR) in development mode
 * - Server-only module protection and tree-shaking
 * - CDN-ready production builds with optimized React imports
 * - WebSocket-based live reload for route changes
 *
 * @param props - Plugin configuration options
 * @param props.style - Routing style convention (currently supports "nextjs")
 * @param props.route - Base path for route files (e.g., "src/pages")
 * @param props.clientShellPath - Optional custom shell for client-side hydration
 * @param props.enableHMR - Enable Hot Module Replacement (default: true on dev & false on prod)
 * @param props.enableFastRefresh - Preserve compatible React state during HMR (default: follows enableHMR)
 *
 * @returns Frame Master plugin instance with React integration
 *
 * @example
 * ```sh
 * # Development with HMR
 * NODE_ENV=development frame-master dev
 * ```
 *
 * @example
 * ```sh
 * # Production build
 * NODE_ENV=production frame-master build
 * ```
 */
export default function applyReactPluginToHTML(
	props: ApplyReactPluginOptions,
): FrameMasterPlugin {
	const {
		style,
		route,
		enableHMR = process.env.NODE_ENV !== "production",
		HMROptions = {},
		enableFastRefresh,
		watchDirectories,
		watchDirectoriesExclude,
		entrypointExtensions = [".tsx", ".jsx"],
		fallbacks = {},
		hydration = "hydrate",
	} = props;
	const fastRefreshEnabled = resolveFastRefreshEnabled(
		enableHMR,
		enableFastRefresh,
	);
	const hmrWebsocketProtocol = resolveHmrWebsocketProtocol(
		HMROptions.websocket,
	);
	const cwd = process.cwd();

	const pathToClientShell = props.clientShellPath
		? join(cwd, props.clientShellPath)
		: join(import.meta.dir, "client-shell.tsx");

	const fileRouter = new Bun.FileSystemRouter({
		dir: join(cwd, route),
		style,
		fileExtensions: entrypointExtensions,
	});

	const wsList: Bun.ServerWebSocket[] = [];
	const routeDir = join(cwd, route);
	const watchDirectoriesResolved = resolveWatchDirectories(
		enableHMR,
		watchDirectories,
		watchDirectoriesExclude,
	);
	let liveBuilder: Builder | null = null;

	const toRoutePath = (fp: string) =>
		join("@apply-react/routes", relative(join(cwd, route), fp));

	const createEntrypoints = (routes: Record<string, string>) =>
		Object.entries(routes).map(([_pathname, fp]) => toRoutePath(fp));

	type DevBuildTarget = {
		matchedRoute: Bun.MatchedRoute;
		pathname: string;
	};

	let currentDevRoute: DevBuildTarget | null = null;
	const queuedDevRoutes: DevBuildTarget[] = [];
	const queuedRouteNames = new Set<string>();
	let pendingRouteUpdate: DevBuildTarget | null = null;
	let selectiveBuildPromise: Promise<void> | null = null;
	let refreshDependencyGraphPromise: Promise<void> | null = null;
	let targetByRouteName = new Map<string, DevBuildTarget>();
	let dependentRouteNamesByFilePath = new Map<string, Set<string>>();

	const sendHMRMessage = (message: HMRMessage) => {
		wsList.forEach((ws) => {
			(ws as unknown as Bun.ServerWebSocket<HMRMessage>).send(
				JSON.stringify(message),
			);
		});
	};

	const queueDevRouteBuild = (target: DevBuildTarget) => {
		const routeName = target.matchedRoute.name;
		if (queuedRouteNames.has(routeName)) return;
		queuedRouteNames.add(routeName);
		queuedDevRoutes.push(target);
	};

	const scheduleDevRouteBuild = (target: DevBuildTarget) => {
		sendHMRMessage({
			type: "route-build-started",
			pathname: target.pathname,
			routeName: target.matchedRoute.name,
		});
		queueDevRouteBuild(target);
	};

	const collectDevBuildTargets = () => {
		const targets: DevBuildTarget[] = [];
		for (const pathname of Object.keys(fileRouter.routes)) {
			const matchedRoute = fileRouter.match(pathname);
			if (!matchedRoute) continue;
			targets.push({
				matchedRoute,
				pathname: matchedRoute.pathname,
			});
		}
		return targets;
	};

	const refreshDependencyGraph = async () => {
		if (refreshDependencyGraphPromise) return refreshDependencyGraphPromise;

		refreshDependencyGraphPromise = (async () => {
			const nextTargetByRouteName = new Map<string, DevBuildTarget>();
			const nextDependentRouteNamesByFilePath = new Map<string, Set<string>>();

			const targets = collectDevBuildTargets();
			for (const target of targets) {
				nextTargetByRouteName.set(target.matchedRoute.name, target);
				const routeFilePath = normalizeWatchedFilePath(
					cwd,
					target.matchedRoute.filePath,
				);
				const dependencies = await collectFileDependencies(routeFilePath, cwd);

				for (const dependencyPath of dependencies) {
					const routes =
						nextDependentRouteNamesByFilePath.get(dependencyPath) ?? new Set();
					routes.add(target.matchedRoute.name);
					nextDependentRouteNamesByFilePath.set(dependencyPath, routes);
				}
			}

			targetByRouteName = nextTargetByRouteName;
			dependentRouteNamesByFilePath = nextDependentRouteNamesByFilePath;
		})().finally(() => {
			refreshDependencyGraphPromise = null;
		});

		return refreshDependencyGraphPromise;
	};

	const runQueuedDevBuilds = async () => {
		const builder = liveBuilder;
		if (!builder || selectiveBuildPromise) return selectiveBuildPromise;

		selectiveBuildPromise = (async () => {
			while (queuedDevRoutes.length > 0) {
				const nextRoute = queuedDevRoutes.shift();
				if (!nextRoute) continue;
				queuedRouteNames.delete(nextRoute.matchedRoute.name);

				const activeBuild = builder.awaitBuildFinish();
				if (builder.isBuilding() && activeBuild) {
					await activeBuild;
				}

				currentDevRoute = nextRoute;
				pendingRouteUpdate = nextRoute;
				await builder.build();
			}
		})()
			.catch((error) => {
				console.error("[Apply-React] Failed to run queued dev build", error);
			})
			.finally(() => {
				selectiveBuildPromise = null;
				if (queuedDevRoutes.length > 0) {
					void runQueuedDevBuilds();
				}
			});

		return selectiveBuildPromise;
	};

	const buildRouteUpdatePath = (target: DevBuildTarget) =>
		target.matchedRoute.src.replace(/\.(tsx|jsx)$/, ".js");

	const requestDevRouteBuild = async (pathname: string) => {
		const matchedRoute = fileRouter.match(pathname);
		if (!matchedRoute) {
			const missingResponse = {
				status: "missing",
				pathname,
			} satisfies DevRouteBuildResponse;
			sendHMRMessage({
				type: "route-build-missing",
				pathname,
			});
			return missingResponse;
		}

		const target = {
			matchedRoute,
			pathname: matchedRoute.pathname,
		} satisfies DevBuildTarget;

		scheduleDevRouteBuild(target);
		void runQueuedDevBuilds();

		return {
			status: "building",
			pathname: target.pathname,
			routeName: target.matchedRoute.name,
		} satisfies DevRouteBuildResponse;
	};

	const getRoutes = (
		current: typeof currentDevRoute,
		fr: typeof fileRouter,
	) => {
		if (!current) return fr.routes;
		return {
			[current.matchedRoute.name]: current.matchedRoute.filePath,
		};
	};

	const generateClientRoutesModule = () => `
          			${Object.entries(getRoutes(currentDevRoute, fileRouter))
									.map(
										([_pathname, filePath], index) =>
											`import _${index} from "${toRoutePath(filePath)}";`,
									)
									.join("\n")}
          				export default { ${Object.entries(fileRouter.routes)
										.map(
											([pathname, fp]) =>
												`"${pathname}": () => import("${fp}").then((mod) => mod.default)`,
										)
										.join(",\n")} };
          			`;

	const virtualModules: NonNullable<FrameMasterPlugin["virtualModules"]> = {
		"@apply-react/client-routes.ts": {
			contents: generateClientRoutesModule,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/client-hydrate.tsx": {
			contents: `export * from "${join(__dirname, "hydrate.tsx")}";`,
			loader: "tsx",
			injectRuntime: true,
		},
		"@apply-react/client-shell.tsx": {
			contents: `export { default } from "${pathToClientShell}";`,
			loader: "tsx",
			injectRuntime: true,
		},
		"@apply-react/HMR.ts": {
			contents: `export * from "${join(__dirname, "HMR.ts")}";`,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/react-refresh-runtime.ts": {
			contents:
				fastRefreshEnabled && !isProd()
					? `export * from "${join(__dirname, "react-refresh-runtime.ts")}";`
					: "export function performReactRefresh() {}",
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/HMR-enabled.ts": {
			contents: `const HMR_ENABLED = ${enableHMR};export default HMR_ENABLED;`,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/fast-refresh-enabled.ts": {
			contents: `const FAST_REFRESH_ENABLED = ${fastRefreshEnabled && !isProd()};export default FAST_REFRESH_ENABLED;`,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/hmr-websocket-protocol.ts": {
			contents: `const HMR_WEBSOCKET_PROTOCOL = ${JSON.stringify(hmrWebsocketProtocol)};export default HMR_WEBSOCKET_PROTOCOL;`,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/development-mode.ts": {
			contents: `const IS_DEVELOPMENT = ${!isProd()};export default IS_DEVELOPMENT;`,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/props.ts": {
			contents: `const props = ${JSON.stringify({ ...props, enableHMR, enableFastRefresh: fastRefreshEnabled, HMROptions: { websocket: hmrWebsocketProtocol }, hydration, entrypointExtensions, fallbacks })}; export default props;`,
			loader: "ts",
			injectRuntime: true,
		},
		"@apply-react/404.tsx": {
			contents: `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
			loader: "tsx",
			injectRuntime: true,
		},
		"@apply-react/loading.tsx": {
			contents: `export { default } from "${fallbacks.defaultLoadingComponentPath ? join(cwd, fallbacks.defaultLoadingComponentPath) : join(__dirname, "fallback", "loading.tsx")}";`,
			loader: "tsx",
			injectRuntime: true,
		},
	};

	return {
		name,
		version,
		requirement: {
			frameMasterVersion: peerDependencies["frame-master"],
		},
		virtualModules,
		serverReady({ builder }) {
			liveBuilder = builder;
			void refreshDependencyGraph();
		},
		serverStop() {
			liveBuilder = null;
			for (const ws of wsList) {
				try {
					ws.close();
				} catch {}
			}
			wsList.length = 0;
		},
		build: {
			buildConfig: () => {
				return {
					entrypoints: [
						...(isProd() ? [] : [...DevReactEntryPoints]),
						...VirtualModules,
						...createEntrypoints(getRoutes(currentDevRoute, fileRouter)),
					],
					splitting: true,
					// Shared chunks must retain stable URLs. Replacing every chunk on
					// HMR creates another React/Refresh runtime and breaks hooks.
					naming: {
						entry: "[dir]/[name].[ext]",
						chunk: isProd()
							? resolveChunkNamingPattern()
							: "chunk-[hash].[ext]",
					},
					minify: isProd(),
					plugins: [
						...(isProd() ? [] : [reactDedupePlugin]),
						{
							name: "apply-routes-to-hydrate",
							setup(build) {
								build.onLoad({ filter: /.*/ }, async (args) => {
									if (await directiveManager.pathIs("server-only", args.path)) {
										return {
											contents: "",
											loader: "js",
										};
									}

									if (
										!fastRefreshEnabled ||
										isProd() ||
										!shouldTransformReactRefreshModule(cwd, args.path)
									) {
										return;
									}

									const contents = await getChainableContent(args);
									const moduleId = relative(cwd, args.path).replaceAll(
										"\\",
										"/",
									);
									return {
										contents: await transformReactRefreshModule(contents, {
											filename: args.path,
											moduleId,
										}),
										loader: getBunLoader(args.path),
									};
								});

								const htmlrewriter = new HTMLRewriter()
									.on("head", {
										element(element) {
											element.append(
												`<script src="@apply-react/client-hydrate.tsx" type="module" id="__hydrate_script__"></script>`,
												{
													html: true,
												},
											);
										},
									})
									.on("script#__hydrate_script__", {
										element(element) {
											element.remove();
										},
									});

								build.onLoad({ filter: /\.html$/ }, async (args) => {
									const contents = await getChainableContent(args);
									const transformed = htmlrewriter.transform(contents);
									return {
										contents: transformed,
									};
								});

								build.finally("html", ({ contents }) => {
									return {
										contents: htmlrewriter.transform(contents as string),
									};
								});
								build.onResolve({ filter: /^@apply-react\/routes/ }, (args) => {
									const realPath = join(
										cwd,
										args.path.replace("@apply-react/routes", route),
									);
									return {
										path: realPath,
									};
								});
							},
						},
					],
				};
			},
			async afterBuild(_config, outputs) {
				if (!pendingRouteUpdate) return;

				const routeFileName = buildRouteUpdatePath(pendingRouteUpdate);
				const routeOutput = outputs.outputs.find((output) =>
					output.path
						.replaceAll("\\", "/")
						.endsWith(`/@apply-react/routes/${routeFileName}`),
				);
				if (routeOutput) {
					const source = await Bun.file(routeOutput.path).text();
					await Bun.write(
						routeOutput.path,
						cacheBustRoutePageChunk(source, Date.now()),
					);
				}

				sendHMRMessage({
					type: "update-routes",
					route: buildRouteUpdatePath(pendingRouteUpdate),
					pathname: pendingRouteUpdate.pathname,
					routeName: pendingRouteUpdate.matchedRoute.name,
				});
				pendingRouteUpdate = null;
				void refreshDependencyGraph();
			},
		},
		serverConfig: {
			routes: {
				"/_REACT_HMR/ws": enableHMR
					? (req, server) =>
							(server as unknown as Bun.Server<{ react_hmr: boolean }>).upgrade(
								req,
								{ data: { react_hmr: true } },
							)
								? new Response("ws upgraded", { status: 101 })
								: new Response("upgrade failed", { status: 400 })
					: new Response("HMR disabled", { status: 503 }),
				"/_REACT_HMR/build-route": enableHMR
					? async (req) => {
							const pathname = new URL(req.url).searchParams.get("pathname");
							if (!pathname) {
								return Response.json(
									{ error: "pathname query parameter is required" },
									{ status: 400 },
								);
							}

							const result = await requestDevRouteBuild(pathname);
							return Response.json(result, {
								status: result.status === "missing" ? 404 : 202,
							});
						}
					: new Response("HMR disabled", { status: 503 }),
			},
		},
		websocket: {
			onOpen(ws) {
				const data = ws.data as { react_hmr?: boolean } | undefined;
				if (!data?.react_hmr) return;
				wsList.push(ws);
			},
			onClose(ws) {
				const index = wsList.indexOf(ws);
				if (index > -1) {
					wsList.splice(index, 1);
				}
			},
		},
		fileSystemWatchDir: watchDirectoriesResolved,
		async onFileSystemChange(_ev, _fname, absolutePath) {
			const changedAbsolutePath = normalizeWatchedFilePath(cwd, absolutePath);
			const routePathname = getRoutePathnameFromFileChange(
				cwd,
				routeDir,
				changedAbsolutePath,
			);

			if (routePathname) {
				const matchedRoute = fileRouter.match(routePathname);
				if (matchedRoute) {
					scheduleDevRouteBuild({
						pathname: matchedRoute.pathname,
						matchedRoute,
					});
					await runQueuedDevBuilds();
					return;
				}
			}

			const dependentRouteNames =
				dependentRouteNamesByFilePath.get(changedAbsolutePath);
			if (!dependentRouteNames || dependentRouteNames.size === 0) {
				void refreshDependencyGraph();
				return;
			}

			for (const routeName of dependentRouteNames) {
				const target = targetByRouteName.get(routeName);
				if (!target) continue;
				scheduleDevRouteBuild(target);
			}
			await runQueuedDevBuilds();
		},
		router: {
			async before_request(master) {
				const acceptHeader = master.request.headers.get("accept") || "";
				if (!acceptHeader.includes("text/html") || !currentDevRoute) return;
				currentDevRoute = null;
				queuedDevRoutes.length = 0;
				queuedRouteNames.clear();
				pendingRouteUpdate = null;
				if (master.builder.isBuilding()) return;
				await master.builder.build();
			},
			html_rewrite: {
				rewrite(reWriter) {
					reWriter
						.on("head", {
							element(element) {
								element.append(
									`<script src="/@apply-react/client-hydrate.js" type="module"></script>`,
									{
										html: true,
									},
								);
							},
						})
						.on("script#__hydrate_script__", {
							element(element) {
								element.remove();
							},
						});
				},
			},
		},
	};
}

export function getRoutePathnameFromFileChange(
	projectRoot: string,
	routeDir: string,
	changedPath: string,
) {
	const normalizedPath = resolve(projectRoot, changedPath);
	const relativePath = relative(routeDir, normalizedPath).replaceAll("\\", "/");

	if (
		!relativePath ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		return null;
	}

	return filePathToPathname(relativePath);
}

function filePathToPathname(fp: string) {
	let fpNoExt = fp.replaceAll("\\", "/").replace(/\.(tsx|jsx)$/, "");
	if (fpNoExt.endsWith("/index") || fpNoExt === "index") {
		fpNoExt = fpNoExt.slice(0, -"/index".length) || "/";
	}
	return fpNoExt.startsWith("/") ? fpNoExt : `/${fpNoExt}`;
}
