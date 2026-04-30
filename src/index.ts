import { join, relative } from "node:path";
import { getBuilder } from "frame-master/build";
import type { FrameMasterPlugin } from "frame-master/plugin";
import { directiveManager } from "frame-master/utils";
import { isProd } from "frame-master/utils";
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
	hydration?: "hydrate" /* | "render"*/;

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

	const toRoutePath = (fp: string) =>
		join("@apply-react/routes", relative(join(cwd, route), fp));

	const createEntrypoints = (routes: Record<string, string>) =>
		Object.entries(routes).map(([_pathname, fp]) => toRoutePath(fp));

	let currentDevRoute: Bun.MatchedRoute | null = null;

	const getRoutes = (
		current: typeof currentDevRoute,
		fr: typeof fileRouter,
	) => {
		if (!current) return fr.routes;
		return {
			[current.pathname]: current.filePath,
		};
	};

	return {
		name,
		version,
		build: {
			buildConfig: () => ({
				entrypoints: [
					...(isProd() ? [] : DevReactEntryPoints),
					"@apply-react/client-routes.ts",
					"@apply-react/client-hydrate.tsx",
					"@apply-react/HMR.ts",
					"@apply-react/client-shell.tsx",
					"@apply-react/404.tsx",
					...createEntrypoints(getRoutes(currentDevRoute, fileRouter)),
				],
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

					"@apply-react/404.tsx": `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
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
						},
					},
				],
			}),
			afterBuild() {
				wsList.forEach((ws) => {
					(ws as unknown as Bun.ServerWebSocket<HMRMessage>).send(
						JSON.stringify({
							type: "update-routes",
							route:
								`${currentDevRoute?.src.replace(/\.(tsx|jsx)$/, ".js")}` as unknown as string,
							pathname: currentDevRoute?.pathname as string,
						} satisfies HMRMessage),
					);
				});
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
			},
		},
		websocket: {
			onOpen(ws) {
				if (!ws.data || !(ws.data as any)["react_hmr"]) return;
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
			if (!absolutePath.startsWith(route) || getBuilder()?.isBuilding()) return;
			const rel = relative(route, absolutePath);
			const pathname = filePathToPathname(rel);
			currentDevRoute = fileRouter.match(pathname);
			getBuilder()?.build();
		},
		router: {
			async before_request(master) {
				const acceptHeader = master.request.headers.get("accept") || "";
				if (!acceptHeader.includes("text/html") || !currentDevRoute) return;
				currentDevRoute = null;
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

function filePathToPathname(fp: string) {
	let fpNoExt = fp.replace(/\.(tsx|jsx)$/, "");
	if (fpNoExt.endsWith("index")) {
		fpNoExt = fpNoExt.slice(0, -"/index".length) || "/";
	}
	return fpNoExt.startsWith("/") ? fpNoExt : `/${fpNoExt}`;
}
