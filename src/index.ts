import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Builder } from "frame-master/build";
import type { FrameMasterPlugin } from "frame-master/plugin";
import { directiveManager, isProd } from "frame-master/utils";
import { name, version } from "../package.json";
import { escapeRegExp } from "./plugin-utils";
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
] as const;

const IMPORT_SPECIFIER_PATTERNS = [
	/(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g,
	/import\s*["']([^"']+)["']/g,
	/import\s*\(\s*["']([^"']+)["']\s*\)/g,
	/require\s*\(\s*["']([^"']+)["']\s*\)/g,
];

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
	 * Options for configuring Hot Module Replacement (HMR)
	 *
	 * @default {}
	 */
	HMROptions?: {
		/* Optional array of module roots for HMR
		 * If provided, HMR will create entrypoints for the specified module roots files.
		 * Relative paths are resolved from the project root.
		 */
		moduleRoots?: string[];
	};

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

const moduleRootGlob = new Bun.Glob("**/*");
function getModuleFromRootPath(root: string) {
	return Array.from(
		moduleRootGlob.scanSync({
			absolute: true,
			onlyFiles: true,
			cwd: root,
		}),
	);
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
		watchDirectories,
		watchDirectoriesExclude,
		entrypointExtensions = [".tsx", ".jsx"],
		fallbacks = {},
		hydration = "hydrate",
	} = props;
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

	const generateVirtualModulePathAndContent = () =>
		({
			"@apply-react/client-routes.ts": `
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
          			`,
			...Object.assign(
				{},
				...Object.entries(fileRouter.routes).map(([_pathname, fp]) => ({
					[toRoutePath(fp)]: `export { default } from "${fp}";`,
				})),
			),
			"@apply-react/client-hydrate.tsx": `export * from "${join(__dirname, "hydrate.tsx")}";`,
			"@apply-react/client-shell.tsx": `export { default } from "${pathToClientShell}";`,
			// HMR modules
			"@apply-react/HMR.ts": `export * from "${join(__dirname, "HMR.ts")}";`,
			"@apply-react/react-refresh-runtime.ts":
				enableHMR && !isProd()
					? `export * from "${join(__dirname, "react-refresh-runtime.ts")}";`
					: "export function performReactRefresh() {}",
			"@apply-react/HMR-enabled.ts": `const HMR_ENABLED = ${enableHMR};export default HMR_ENABLED;`,
			"@apply-react/props.ts": `const props = ${JSON.stringify({ ...props, hydration, entrypointExtensions, fallbacks })}; export default props;`,
			"@apply-react/404.tsx": `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
			"@apply-react/loading.tsx": `export { default } from "${fallbacks.defaultLoadingComponentPath ? join(cwd, fallbacks.defaultLoadingComponentPath) : join(__dirname, "fallback", "loading.tsx")}";`,
		}) as Record<string, string>;
	return {
		name,
		version,
		serverReady({ builder }) {
			liveBuilder = builder;
			void refreshDependencyGraph();
		},
		build: {
			buildConfig: () => {
				const virtualModulesList = generateVirtualModulePathAndContent();

				return {
					entrypoints: [
						...(isProd() ? [] : [...DevReactEntryPoints]),
						...VirtualModules,
						...createEntrypoints(getRoutes(currentDevRoute, fileRouter)),
						...(HMROptions.moduleRoots?.flatMap(getModuleFromRootPath) ?? []),
					],
					splitting: true,
					files: virtualModulesList,
					plugins: [
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
										!enableHMR ||
										isProd() ||
										!isWithinProject(cwd, args.path) ||
										!TRACKED_SOURCE_EXTENSIONS.has(extname(args.path)) ||
										NON_RECURSIVE_EXTENSIONS.has(extname(args.path))
									) {
										return;
									}

									const contents =
										args.__chainedContents ??
										virtualModulesList[args.path] ??
										(await Bun.file(args.path).text());
									const moduleId = relative(cwd, args.path).replaceAll(
										"\\",
										"/",
									);
									return {
										contents: await transformReactRefreshModule(
											contents as string,
											{
												filename: args.path,
												moduleId,
											},
										),
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
									const contents =
										args.__chainedContents ??
										(await Bun.file(args.path).text());
									const transformed = htmlrewriter.transform(
										contents as string,
									);
									return {
										contents: transformed,
									};
								});

								build.finally("html", ({ contents, path }) => {
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
			afterBuild() {
				if (!pendingRouteUpdate) return;

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
		runtimePlugins: [
			{
				name: "apply-react-runtime",
				setup(runtime) {
					const virtualModules = generateVirtualModulePathAndContent();

					Object.entries(virtualModules).forEach(([path, content]) => {
						runtime.onResolve({ filter: escapeRegExp(path) }, (args) => {
							return {
								path,
								namespace: "apply-react-virtual",
							};
						});
						runtime.onLoad(
							{ filter: escapeRegExp(path), namespace: "apply-react-virtual" },
							async (args) => {
								return {
									contents: content,
									loader: path.split(".").pop() as "ts",
								};
							},
						);
					});
				},
			},
		],
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
		onFileSystemChange(_ev, _fname, absolutePath) {
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
					void runQueuedDevBuilds();
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
			void runQueuedDevBuilds();
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
	const relativePath = relative(routeDir, normalizedPath);

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
	let fpNoExt = fp.replace(/\.(tsx|jsx)$/, "");
	if (fpNoExt.endsWith("index")) {
		fpNoExt = fpNoExt.slice(0, -"/index".length) || "/";
	}
	return fpNoExt.startsWith("/") ? fpNoExt : `/${fpNoExt}`;
}
