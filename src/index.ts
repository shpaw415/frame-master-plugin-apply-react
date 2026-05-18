import { isAbsolute, join, relative, resolve } from "node:path";
import type { Builder } from "frame-master/build";
import type { FrameMasterPlugin } from "frame-master/plugin";
import { directiveManager, isProd } from "frame-master/utils";
import { name, version } from "../package.json";

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

	const DevReactEntryPoints = [
		"react",
		"react-dom",
		"node_modules/react/cjs/react-jsx-dev-runtime.development.js",
		"node_modules/react/jsx-dev-runtime.js",
		"node_modules/react/cjs/react.development.js",
		"node_modules/react-dom/cjs/react-dom.development.js",
	];
	const wsList: Bun.ServerWebSocket[] = [];
	const routeDir = join(cwd, route);
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
	let queuedDevRoute: DevBuildTarget | null = null;
	let pendingRouteUpdate: DevBuildTarget | null = null;
	let selectiveBuildPromise: Promise<void> | null = null;

	const sendHMRMessage = (message: HMRMessage) => {
		wsList.forEach((ws) => {
			(ws as unknown as Bun.ServerWebSocket<HMRMessage>).send(
				JSON.stringify(message),
			);
		});
	};

	const queueDevRouteBuild = (target: DevBuildTarget) => {
		queuedDevRoute = target;
	};

	const runQueuedDevBuilds = async () => {
		const builder = liveBuilder;
		if (!builder || selectiveBuildPromise) return selectiveBuildPromise;

		selectiveBuildPromise = (async () => {
			while (queuedDevRoute) {
				const nextRoute = queuedDevRoute;
				queuedDevRoute = null;

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
				if (queuedDevRoute) {
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

		sendHMRMessage({
			type: "route-build-started",
			pathname: target.pathname,
			routeName: target.matchedRoute.name,
		});
		queueDevRouteBuild(target);
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

	return {
		name,
		version,
		serverReady({ builder }) {
			liveBuilder = builder;
		},
		build: {
			buildConfig: () => ({
				entrypoints: [
					...(isProd() ? [] : DevReactEntryPoints),
					"@apply-react/client-routes.ts",
					"@apply-react/client-hydrate.tsx",
					"@apply-react/HMR.ts",
					"@apply-react/client-shell.tsx",
					"@apply-react/404.tsx",
					"@apply-react/loading.tsx",
					...createEntrypoints(getRoutes(currentDevRoute, fileRouter)),
				],
				splitting: true,
				files: {
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
					"@apply-react/HMR-enabled.ts": `const HMR_ENABLED = ${enableHMR};export default HMR_ENABLED;`,
					"@apply-react/props.ts": `const props = ${JSON.stringify({ ...props, hydration, entrypointExtensions, fallbacks })}; export default props;`,
					"@apply-react/404.tsx": `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
					"@apply-react/loading.tsx": `export { default } from "${fallbacks.defaultLoadingComponentPath ? join(cwd, fallbacks.defaultLoadingComponentPath) : join(__dirname, "fallback", "loading.tsx")}";`,
				},
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
									args.__chainedContents ?? (await Bun.file(args.path).text());
								const transformed = htmlrewriter.transform(contents as string);

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
			}),
			afterBuild() {
				if (!pendingRouteUpdate) return;

				sendHMRMessage({
					type: "update-routes",
					route: buildRouteUpdatePath(pendingRouteUpdate),
					pathname: pendingRouteUpdate.pathname,
					routeName: pendingRouteUpdate.matchedRoute.name,
				});
				pendingRouteUpdate = null;
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
		fileSystemWatchDir: enableHMR ? [route] : undefined,
		onFileSystemChange(_ev, _fname, absolutePath) {
			console.log(`[Apply-React] File change detected: ${absolutePath}`);
			const routePathname = getRoutePathnameFromFileChange(
				cwd,
				routeDir,
				absolutePath,
			);
			if (!routePathname) return;
			const matchedRoute = fileRouter.match(routePathname);

			if (!matchedRoute) return;

			sendHMRMessage({
				type: "route-build-started",
				pathname: matchedRoute.pathname,
				routeName: matchedRoute.name,
			});
			queueDevRouteBuild({ pathname: matchedRoute.pathname, matchedRoute });
			void runQueuedDevBuilds();
		},
		router: {
			async before_request(master) {
				const acceptHeader = master.request.headers.get("accept") || "";
				if (!acceptHeader.includes("text/html") || !currentDevRoute) return;
				currentDevRoute = null;
				queuedDevRoute = null;
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
