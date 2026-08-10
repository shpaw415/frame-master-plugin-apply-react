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
			// Runtime-only browser URL — must stay external to the Bun build
			// (see onResolve for /^\/@apply-react\/mod\//). Build-time resolution
			// of absolute /@apply-react/mod/... paths fails (e.g. [id].tsx routes).
			const mod = toModUrl(moduleRootAbs, fp);
			return `"${pathname}": () => import(${JSON.stringify(mod)}).then((m) => m.default)`;
		}
		return `"${pathname}": () => import(${JSON.stringify(fp)}).then((m) => m.default)`;
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

	/** Virtual modules that must be entrypoints so runtime can load them by URL. */
	const virtualRuntimeEntrypoints = [
		"@apply-react/client-routes.ts",
		"@apply-react/client-hydrate.tsx",
		"@apply-react/HMR.ts",
		"@apply-react/HMR-enabled.ts",
		"@apply-react/props.ts",
		"@apply-react/client-shell.tsx",
		"@apply-react/404.tsx",
		"@apply-react/loading.tsx",
	] as const;

	const virtualFiles = (): Record<string, string> => ({
		"@apply-react/client-routes.ts": perFileGraph
			? `
          				export default { ${Object.entries(fileRouter.routes)
											.map(([pathname, fp]) => routeImportLine(pathname, fp))
											.join(",\n")} };
          			`
			: `
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
		"@apply-react/client-hydrate.tsx": `export * from "${join(__dirname, "hydrate.tsx")}";`,
		"@apply-react/client-shell.tsx": `export { default } from "${pathToClientShell}";`,
		"@apply-react/HMR.ts": `export * from "${join(__dirname, "HMR.ts")}";`,
		// Always emitted as own entry so import "@apply-react/props.ts" resolves in build + runtime
		"@apply-react/HMR-enabled.ts": `const HMR_ENABLED = ${enableHMR};\nexport default HMR_ENABLED;\n`,
		"@apply-react/props.ts": `const props = ${JSON.stringify(publicProps)};\nexport default props;\n`,
		"@apply-react/404.tsx": `export { default } from "${fallbacks.defaultNotFoundComponentPath ? join(cwd, fallbacks.defaultNotFoundComponentPath) : join(__dirname, "fallback", "404.tsx")}";`,
		"@apply-react/loading.tsx": `export { default } from "${fallbacks.defaultLoadingComponentPath ? join(cwd, fallbacks.defaultLoadingComponentPath) : join(__dirname, "fallback", "loading.tsx")}";`,
		...(perFileGraph
			? {}
			: Object.assign(
					{},
					...Object.entries(fileRouter.routes).map(([_pathname, fp]) => ({
						[toRoutePath(fp)]: `export { default } from "${fp}";`,
					})),
				)),
	});

	const applyReactBuildPlugin = {
		name: "apply-routes-to-hydrate",
		setup(build: {
			onLoad: (
				opts: { filter: RegExp; namespace?: string },
				cb: (args: {
					path: string;
					__chainedContents?: string;
				}) =>
					| { contents: string; loader?: string }
					| undefined
					| Promise<{ contents: string; loader?: string } | undefined>,
			) => void;
			onResolve: (
				opts: { filter: RegExp },
				cb: (args: { path: string }) =>
					| { path: string; namespace?: string; external?: boolean }
					| undefined,
			) => void;
			finally: (
				filter: string,
				cb: (args: { contents: string }) => { contents: string },
			) => void;
		}) {
			const files = virtualFiles();

			// Browser-only per-file module URLs — never bundle/resolve at build time
			build.onResolve({ filter: /^\/@apply-react\/mod\// }, (args) => ({
				path: args.path,
				external: true,
			}));

			// Ensure @apply-react/* virtuals resolve even when not yet pulled as deps
			build.onResolve({ filter: /^@apply-react\// }, (args) => {
				const key = args.path;
				if (key in files || key.startsWith("@apply-react/routes/")) {
					return { path: key, namespace: "apply-react-virtual" };
				}
				return undefined;
			});

			build.onLoad(
				{ filter: /.*/, namespace: "apply-react-virtual" },
				(args) => {
					const contents = files[args.path];
					if (contents == null) return undefined;
					const loader = args.path.endsWith(".tsx")
						? "tsx"
						: args.path.endsWith(".ts")
							? "ts"
							: args.path.endsWith(".jsx")
								? "jsx"
								: "js";
					return { contents, loader };
				},
			);

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
					args.__chainedContents ?? (await Bun.file(args.path).text());
				return {
					contents: htmlrewriter.transform(contents as string),
				};
			});
			build.finally("html", ({ contents }) => ({
				contents: htmlrewriter.transform(contents as string),
			}));

			if (!perFileGraph) {
				build.onResolve({ filter: /^@apply-react\/routes/ }, (args) => {
					const realPath = join(
						cwd,
						args.path.replace("@apply-react/routes", route),
					);
					return { path: realPath };
				});
			}
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
				const files = virtualFiles();
				// Per-file graph: thin runtime entries only — pages load via /@apply-react/mod/*
				if (perFileGraph) {
					return {
						entrypoints: [...DevReactEntryPoints, ...virtualRuntimeEntrypoints],
						splitting: false,
						// Absolute /@apply-react/mod/* imports are browser runtime URLs
						external: [/^\/@apply-react\/mod\//],
						files,
						plugins: [applyReactBuildPlugin],
					};
				}

				// Bundled (prod / explicit hmr.moduleGraph: "bundled")
				return {
					entrypoints: [
						...(isProd() ? [] : DevReactEntryPoints),
						...virtualRuntimeEntrypoints,
						...createEntrypoints(getRoutes()),
					],
					splitting: true,
					files,
					plugins: [applyReactBuildPlugin],
				};
			},
			afterBuild() {
				hmr.handleAfterBuild();
			},
		},
		serverConfig: {
			routes: {
				// Bun route patterns: also match encoded dynamic segments (%5B id %5D)
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
