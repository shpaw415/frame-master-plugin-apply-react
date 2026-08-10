import { join, relative } from "node:path";
import type { FrameMasterPlugin } from "frame-master/plugin";
import { directiveManager, isProd } from "frame-master/utils";
import { name, version } from "../package.json";
import { handleModRequest, toModUrl } from "./hmr/mod-server";
import { resolveModuleRoot } from "./hmr/module-root";
import { createHmrServer } from "./hmr/server";
import { getRoutePathnameFromFileChange } from "./hmr/watch";

export type { ApplyReactHmrOptions, ApplyReactPluginOptions } from "./options";

import type { ApplyReactPluginOptions } from "./options";

export { getRoutePathnameFromFileChange } from "./hmr/watch";
export {
	classifyWatchPath,
	filePathToPathname,
	isSpecialRouteName,
	resolveWatchDirectories,
	shouldIgnoreWatchPath,
} from "./hmr/watch";
export { extractImportSpecifiers } from "./hmr/deps";
export { createHmrServer } from "./hmr/server";
export { resolveModuleRoot } from "./hmr/module-root";
export { toModUrl, handleModRequest } from "./hmr/mod-server";

/**
 * Apply React Plugin for Frame Master
 *
 * Enables React support with client-side hydration and failsafe HMR.
 *
 * **use with frame-master-plugin-react-to-html** for full SSR.
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
		watchDirectories,
		watchDirectoriesExclude,
		hmr: hmrOpts,
		debug = process.env.DEBUG_APPLY_REACT === "1",
	} = props;
	const cwd = process.cwd();

	const pathToClientShell = props.clientShellPath
		? join(cwd, props.clientShellPath)
		: join(import.meta.dir, "client-shell.tsx");

	const { absolute: moduleRootAbs, relative: moduleRootRel } =
		resolveModuleRoot(cwd, route, props.moduleRoot);

	const perFileGraph =
		enableHMR &&
		!isProd() &&
		(hmrOpts?.moduleGraph ?? "per-file") === "per-file";

	const fileRouter = new Bun.FileSystemRouter({
		dir: join(cwd, route),
		style,
		fileExtensions: entrypointExtensions,
	});

	const DevReactEntryPoints = isProd()
		? []
		: ["react", "react-dom", "react/jsx-dev-runtime"];
	const routeDir = join(cwd, route);

	const resolvedWatchDirs =
		watchDirectories ?? (perFileGraph ? [moduleRootRel] : ["."]);

	const hmr = createHmrServer({
		cwd,
		route,
		routeDir,
		enableHMR,
		fileRouter,
		watchDirectories: resolvedWatchDirs,
		watchDirectoriesExclude,
		runtimePaths: [
			pathToClientShell,
			join(import.meta.dir, "hydrate.tsx"),
			join(import.meta.dir, "HMR.ts"),
			join(import.meta.dir, "router.tsx"),
		],
		debounceMs: hmrOpts?.debounceMs ?? 75,
		debug,
		moduleRootAbs,
		perFileGraph,
	});

	const toRoutePath = (fp: string) =>
		join("@apply-react/routes", relative(join(cwd, route), fp));

	const createEntrypoints = (routes: Record<string, string>) =>
		Object.entries(routes).map(([_pathname, fp]) => toRoutePath(fp));

	const getRoutes = () => hmr.getRoutesForBuild();

	const routeImportLine = (pathname: string, fp: string) => {
		if (perFileGraph) {
			const mod = toModUrl(moduleRootAbs, fp);
			return `"${pathname}": () => import("${mod}").then((mod) => mod.default)`;
		}
		return `"${pathname}": () => import("${fp}").then((mod) => mod.default)`;
	};

	const publicProps = {
		...props,
		hydration,
		entrypointExtensions,
		fallbacks,
		enableHMR,
		moduleRoot: moduleRootRel,
		hmr: {
			...hmrOpts,
			moduleGraph: perFileGraph ? "per-file" : "bundled",
			preserveState: hmrOpts?.preserveState ?? true,
		},
	};

	if (debug) {
		console.log(
			`[Apply-React] moduleRoot=${moduleRootRel} perFileGraph=${perFileGraph}`,
		);
	}

	return {
		name,
		version,
		serverReady({ builder }) {
			hmr.setBuilder(builder);
		},
		build: {
			buildConfig: () => {
				// Per-file graph: thin runtime entries only — pages load via /@apply-react/mod/*
				if (perFileGraph) {
					return {
						entrypoints: [
							...DevReactEntryPoints,
							"@apply-react/client-routes.ts",
							"@apply-react/client-hydrate.tsx",
							"@apply-react/HMR.ts",
							"@apply-react/client-shell.tsx",
							"@apply-react/404.tsx",
							"@apply-react/loading.tsx",
						],
						// Avoid shared app chunks; runtime stays small. Pages are unbundled mod URLs.
						splitting: false,
						files: {
							"@apply-react/client-routes.ts": `
          				export default { ${Object.entries(fileRouter.routes)
											.map(([pathname, fp]) => routeImportLine(pathname, fp))
											.join(",\n")} };
          			`,
							"@apply-react/client-hydrate.tsx": `export * from "${join(__dirname, "hydrate.tsx")}";`,
							"@apply-react/client-shell.tsx": `export { default } from "${pathToClientShell}";`,
							"@apply-react/HMR.ts": `export * from "${join(__dirname, "HMR.ts")}";`,
							"@apply-react/HMR-enabled.ts": `const HMR_ENABLED = ${enableHMR};export default HMR_ENABLED;`,
							"@apply-react/props.ts": `const props = ${JSON.stringify(publicProps)}; export default props;`,
							"@apply-react/404.tsx": `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
							"@apply-react/loading.tsx": `export { default } from "${fallbacks.defaultLoadingComponentPath ? join(cwd, fallbacks.defaultLoadingComponentPath) : join(__dirname, "fallback", "loading.tsx")}";`,
						},
						plugins: [
							{
								name: "apply-routes-to-hydrate",
								setup(build) {
									build.onLoad({ filter: /.*/ }, async (args) => {
										if (
											await directiveManager.pathIs("server-only", args.path)
										) {
											return { contents: "", loader: "js" };
										}
									});

									const htmlrewriter = new HTMLRewriter()
										.on("head", {
											element(element) {
												element.append(
													`<script src="@apply-react/client-hydrate.tsx" type="module" id="__hydrate_script__"></script>`,
													{ html: true },
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
										return {
											contents: htmlrewriter.transform(contents as string),
										};
									});
									build.finally("html", ({ contents }) => ({
										contents: htmlrewriter.transform(contents as string),
									}));
								},
							},
						],
					};
				}

				// Bundled (prod / explicit hmr.moduleGraph: "bundled")
				return {
					entrypoints: [
						...(isProd() ? [] : DevReactEntryPoints),
						"@apply-react/client-routes.ts",
						"@apply-react/client-hydrate.tsx",
						"@apply-react/HMR.ts",
						"@apply-react/client-shell.tsx",
						"@apply-react/404.tsx",
						"@apply-react/loading.tsx",
						...createEntrypoints(getRoutes()),
					],
					splitting: true,
					files: {
						"@apply-react/client-routes.ts": `
          			${Object.entries(getRoutes())
									.map(
										([_pathname, filePath], index) =>
											`import _${index} from "${toRoutePath(filePath)}";`,
									)
									.join("\n")}
          				export default { ${Object.entries(fileRouter.routes)
										.map(([pathname, fp]) => routeImportLine(pathname, fp))
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
						"@apply-react/HMR.ts": `export * from "${join(__dirname, "HMR.ts")}";`,
						"@apply-react/HMR-enabled.ts": `const HMR_ENABLED = ${enableHMR};export default HMR_ENABLED;`,
						"@apply-react/props.ts": `const props = ${JSON.stringify(publicProps)}; export default props;`,
						"@apply-react/404.tsx": `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
						"@apply-react/loading.tsx": `export { default } from "${fallbacks.defaultLoadingComponentPath ? join(cwd, fallbacks.defaultLoadingComponentPath) : join(__dirname, "fallback", "loading.tsx")}";`,
					},
					plugins: [
						{
							name: "apply-routes-to-hydrate",
							setup(build) {
								build.onLoad({ filter: /.*/ }, async (args) => {
									if (await directiveManager.pathIs("server-only", args.path)) {
										return { contents: "", loader: "js" };
									}
								});

								const htmlrewriter = new HTMLRewriter()
									.on("head", {
										element(element) {
											element.append(
												`<script src="@apply-react/client-hydrate.tsx" type="module" id="__hydrate_script__"></script>`,
												{ html: true },
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
									return {
										contents: htmlrewriter.transform(contents as string),
									};
								});
								build.finally("html", ({ contents }) => ({
									contents: htmlrewriter.transform(contents as string),
								}));
								build.onResolve({ filter: /^@apply-react\/routes/ }, (args) => {
									const realPath = join(
										cwd,
										args.path.replace("@apply-react/routes", route),
									);
									return { path: realPath };
								});
							},
						},
					],
				};
			},
			afterBuild() {
				hmr.handleAfterBuild();
			},
		},
		serverConfig: {
			routes: {
				"/@apply-react/mod/*": perFileGraph
					? (req) => handleModRequest(req, moduleRootAbs)
					: new Response("per-file module graph disabled", { status: 404 }),
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

							const result = await hmr.requestDevRouteBuild(pathname);
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
				hmr.onSocketOpen(ws);
			},
			onClose(ws) {
				hmr.onSocketClose(ws);
			},
			onMessage(ws, message) {
				const data = ws.data as { react_hmr?: boolean } | undefined;
				if (!data?.react_hmr) return;
				hmr.onSocketMessage(ws, message as string | Buffer);
			},
		},
		fileSystemWatchDir: enableHMR ? hmr.watchDirs : undefined,
		onFileSystemChange(_ev, _fname, absolutePath) {
			hmr.onFileSystemChange(absolutePath);
		},
		router: {
			async before_request(master) {
				const acceptHeader = master.request.headers.get("accept") || "";
				if (!acceptHeader.includes("text/html") || !hmr.getCurrentDevRoute())
					return;
				hmr.clearSelectiveRoute();
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
