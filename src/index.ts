import { join } from "node:path";
import { getBuilder } from "frame-master/build";
import type { FrameMasterPlugin } from "frame-master/plugin";
import { directiveManager } from "frame-master/utils";
import { isProd } from "frame-master/utils";
import { name, version } from "../package.json";

declare global {
	var HMR_ENABLED: boolean;
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
	} = props;
	process.env.PUBLIC_HMR_ENABLED = enableHMR ? "true" : "false";
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
	return {
		name,
		version,
		build: {
			buildConfig: {
				entrypoints: [
					...(isProd() ? [] : DevReactEntryPoints),
					"@apply-react/client-routes.ts",
					"@apply-react/client-hydrate.tsx",
					"@apply-react/HMR.ts",
					"@apply-react/client-shell.tsx",
				],
				files: {
					"@apply-react/client-routes.ts": `
          ${Object.entries(fileRouter.routes)
						.map(
							([_pathname, filePath], index) =>
								`import _${index} from "${filePath}";`,
						)
						.join("\n")}
          export default { ${Object.entries(fileRouter.routes)
						.map(([pathname, _fp], index) => `"${pathname}": _${index}`)
						.join(",\n")} };
          `,
					"@apply-react/HMR.ts": `export * from "${join(__dirname, "HMR.ts")}";
					`,
					"@apply-react/client-hydrate.tsx": `export * from "${join(__dirname, "hydrate.tsx")}";`,
					"@apply-react/client-shell.tsx": `export { default } from "${pathToClientShell}";`,
					"@apply-react/HMR-enabled.ts": `export const HMR_ENABLED = ${enableHMR};`,
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

							const htmlrewriter = new HTMLRewriter().on("head", {
								element(element) {
									element.append(
										`<script src="@apply-react/client-hydrate.tsx" type="module" id="__hydrate_script__"></script>`,
										{
											html: true,
										},
									);
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
						},
					},
				],
			},
			afterBuild() {
				wsList.forEach((ws) => {
					ws.send("update-routes");
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
		onFileSystemChange(_ev, _fp, absolutePath) {
			if (!absolutePath.startsWith(route) || getBuilder()?.isBuilding()) return;
			getBuilder()?.build();
		},
		router: {
			before_request(master) {
				master.setGlobalValues({
					HMR_ENABLED: process.env.NODE_ENV === "development",
				});
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
