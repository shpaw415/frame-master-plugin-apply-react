import { join, relative, resolve } from "node:path";
import type { FrameMasterPlugin } from "frame-master/plugin";
import { directiveManager, isProd } from "frame-master/utils";
import { name, version } from "../package.json";
import {
	handleBuiltModRequest,
	listModuleFiles,
	resolveModFile,
	rewriteRelativeImportsToModUrls,
	toModUrl,
	toVirtualModEntry,
} from "./hmr/mod-server";
import {
	findContainingRoot,
	isUnderModuleRoots,
	resolveModuleRoot,
	resolveModuleRoots,
} from "./hmr/module-root";
import {
	buildReactVendorVirtualFiles,
	ensureSingleImportMapInHtml,
	fixExternalReactCjsInterop,
	REACT_BARE_TO_URL,
	REACT_VENDOR_ENTRYPOINTS,
	rewriteBareReactImportsToUrls,
} from "./hmr/react-imports";
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
export {
	resolveModuleRoot,
	resolveModuleRoots,
	findContainingRoot,
	isUnderModuleRoots,
	compileEntrypointExclude,
	matchesEntrypointExclude,
	toModPublicRel,
} from "./hmr/module-root";
export type { ModuleRootEntry } from "./hmr/module-root";
export {
	toModUrl,
	toVirtualModEntry,
	listModuleFiles,
	handleBuiltModRequest,
	handleModRequest,
	rewriteRelativeImportsToModUrls,
	resolveBuiltModPath,
	resolveModFile,
} from "./hmr/mod-server";

const REACT_BARE_IMPORT_RE =
	/^(react|react-dom)(\/jsx-runtime|\/jsx-dev-runtime|\/client)?$/;

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

	const moduleRoots = resolveModuleRoots(cwd, route, props.moduleRoot);
	const moduleRootRels = moduleRoots.map((r) => r.relative);
	/** Primary root (first) — kept for single-value public props / BC */
	const moduleRootRel =
		moduleRootRels.length === 1 ? moduleRootRels[0]! : moduleRootRels;

	const perFileGraph =
		enableHMR &&
		!isProd() &&
		(hmrOpts?.moduleGraph ?? "per-file") === "per-file";

	const entrypointMode = hmrOpts?.entrypointMode ?? "all";
	const entrypointExclude = hmrOpts?.entrypointExclude;

	const fileRouter = new Bun.FileSystemRouter({
		dir: join(cwd, route),
		style,
		fileExtensions: entrypointExtensions,
	});

	/**
	 * Stable browser vendor entrypoints (`react.js`, `react/jsx-dev-runtime.js`, …).
	 * Virtual re-exports of real packages — guaranteed outdir paths for import map
	 * and absolute `/react.js` imports (bare package entry names are unreliable).
	 */
	const reactVendorFiles = (): Record<string, string> => {
		if (!perFileGraph && isProd()) return {};
		try {
			return buildReactVendorVirtualFiles(cwd, import.meta.dir);
		} catch (err) {
			console.error(
				"[Apply-React] failed to resolve React vendor packages for browser entrypoints:",
				err,
			);
			return {};
		}
	};

	const routeDir = join(cwd, route);

	const resolvedWatchDirs =
		watchDirectories ?? (perFileGraph ? moduleRootRels : ["."]);

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
		moduleRoots,
		perFileGraph,
	});

	const toRoutePath = (fp: string) =>
		join("@apply-react/routes", relative(join(cwd, route), fp));

	const createEntrypoints = (routes: Record<string, string>) =>
		Object.entries(routes).map(([_pathname, fp]) => toRoutePath(fp));

	const getRoutes = () => hmr.getRoutesForBuild();

	const routeImportLine = (pathname: string, fp: string) => {
		if (perFileGraph) {
			const mod = toModUrl(moduleRoots, fp);
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
			entrypointMode,
			entrypointExclude,
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

	const collectModEntrypoints = (): string[] => {
		if (!perFileGraph) return [];
		const seeds = [
			...Object.values(fileRouter.routes),
			pathToClientShell,
			fallbacks.defaultNotFoundComponentPath
				? join(cwd, fallbacks.defaultNotFoundComponentPath)
				: "",
			fallbacks.defaultLoadingComponentPath
				? join(cwd, fallbacks.defaultLoadingComponentPath)
				: "",
		].filter(Boolean);
		const files = listModuleFiles(moduleRoots, entrypointMode, seeds, {
			cwd,
			entrypointExclude,
		});
		return files.map((fp) => toVirtualModEntry(moduleRoots, fp));
	};

	const virtualFiles = (): Record<string, string> => {
		const vendor = perFileGraph ? reactVendorFiles() : {};
		return {
			...vendor,
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
		};
	};

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
				cb: (args: {
					path: string;
					importer?: string;
				}) =>
					| { path: string; namespace?: string; external?: boolean }
					| undefined,
			) => void;
			finally: (
				filter: string,
				cb: (args: {
					contents: string;
					path?: string;
				}) => { contents: string },
			) => void;
		}) {
			const files = virtualFiles();
			const vendorEntrySet = new Set(
				REACT_VENDOR_ENTRYPOINTS.filter((k) => k in files),
			);

			// Browser-only per-file module URLs — never bundle at build time
			build.onResolve({ filter: /^\/@apply-react\/mod\// }, (args) => ({
				path: args.path,
				external: true,
			}));

			// Absolute /react.js etc. (after rewrite or import map targets)
			build.onResolve({ filter: /^\/react(-dom)?(\/|\.js$)/ }, (args) => ({
				path: args.path,
				external: true,
			}));

			// Virtual vendor entrypoints (`react.js`, …) → apply-react-virtual namespace
			if (vendorEntrySet.size > 0) {
				build.onResolve(
					{
						filter:
							/^(react\.js|react-dom\.js|react-dom\/client\.js|react\/jsx-runtime\.js|react\/jsx-dev-runtime\.js)$/,
					},
					(args) => {
						const key = args.path.split("?")[0] ?? args.path;
						if (vendorEntrySet.has(key as (typeof REACT_VENDOR_ENTRYPOINTS)[number])) {
							return { path: key, namespace: "apply-react-virtual" };
						}
						return undefined;
					},
				);
			}

			// Virtual entry keys `@apply-react/mod/<rel>` → real source under moduleRoot(s)
			if (perFileGraph) {
				build.onResolve({ filter: /^@apply-react\/mod\// }, (args) => {
					const key = (args.path.split("?")[0] ?? args.path).replace(
						/\\/g,
						"/",
					);
					// resolveModFile expects a public URL path `/@apply-react/mod/...`
					const urlPath = key.startsWith("/") ? key : `/${key}`;
					const file = resolveModFile(moduleRoots, urlPath);
					if (!file) return undefined;
					return { path: file };
				});

				// Bare react/* → external (afterBuild rewrites to /react.js).
				// Vendor shims import absolute package paths, not bare names.
				build.onResolve({ filter: REACT_BARE_IMPORT_RE }, (args) => {
					if (!args.importer) return undefined;
					const importer = (
						args.importer.split("?")[0] ?? args.importer
					).replace(/\\/g, "/");
					if (
						vendorEntrySet.has(
							importer as (typeof REACT_VENDOR_ENTRYPOINTS)[number],
						)
					) {
						return undefined;
					}
					return { path: args.path, external: true };
				});
			}

			// Ensure @apply-react/* virtuals resolve even when not yet pulled as deps
			build.onResolve({ filter: /^@apply-react\// }, (args) => {
				const key = args.path;
				if (key.startsWith("@apply-react/mod/")) return undefined;
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

			// Per-file: rewrite relative imports → stable /@apply-react/mod/*.js URLs.
			// Runs last in the FM onLoad chain when registered after other plugins;
			// also uses __chainedContents so earlier plugin transforms are preserved.
			if (perFileGraph) {
				build.onLoad(
					{ filter: /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/ },
					async (args) => {
						const normalized = resolve(
							(args.path.split("?")[0] ?? args.path).replace(/\\/g, "/"),
						);
						if (!isUnderModuleRoots(moduleRoots, normalized)) {
							return undefined;
						}
						const chained = (
							args as { __chainedContents?: string | Uint8Array }
						).__chainedContents;
						let text: string;
						if (chained != null) {
							text =
								typeof chained === "string"
									? chained
									: new TextDecoder().decode(chained);
						} else {
							const file = Bun.file(normalized);
							if (!(await file.exists())) return undefined;
							text = await file.text();
						}
						const ext = normalized.slice(normalized.lastIndexOf("."));
						const loader =
							ext === ".tsx"
								? "tsx"
								: ext === ".ts" || ext === ".mts" || ext === ".cts"
									? "ts"
									: ext === ".jsx"
										? "jsx"
										: "js";
						return {
							contents: rewriteRelativeImportsToModUrls(
								text,
								normalized,
								moduleRoots,
							),
							loader,
						};
					},
				);
			}

			// Hydrate script only via HTMLRewriter. Import map is handled once by
			// ensureSingleImportMapInHtml (merge/replace/collapse — never 2 maps).
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

			const finalizeHtml = (raw: string): string => {
				let html = htmlrewriter.transform(raw);
				if (perFileGraph) {
					html = ensureSingleImportMapInHtml(html);
				}
				return html;
			};

			build.onLoad({ filter: /\.html$/ }, async (args) => {
				const contents =
					args.__chainedContents ?? (await Bun.file(args.path).text());
				return {
					contents: finalizeHtml(contents as string),
				};
			});
			// Frame-Master chained post-process on every HTML build output
			build.finally("html", ({ contents }) => {
				const raw =
					typeof contents === "string"
						? contents
						: new TextDecoder().decode(contents as unknown as Uint8Array);
				return { contents: finalizeHtml(raw) };
			});

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
			`[Apply-React] moduleRoot=${JSON.stringify(moduleRootRels)} perFileGraph=${perFileGraph} entrypointMode=${entrypointMode} entrypointExclude=${entrypointExclude?.length ?? 0}`,
		);
	}

	let liveOutDir = join(cwd, ".frame-master/build");

	const kickRebuildForMissingMod = () => {
		hmr.requestModGraphRebuild("missing mod artifact");
	};

	return {
		name,
		version,
		serverReady({ builder }) {
			hmr.setBuilder(builder);
			if (builder.outDir) {
				liveOutDir = resolve(cwd, builder.outDir);
			}
		},
		build: {
			buildConfig: () => {
				const files = virtualFiles();
				const vendorEntries = REACT_VENDOR_ENTRYPOINTS.filter((k) => k in files);
				if (perFileGraph) {
					const modEntries = collectModEntrypoints();
					if (debug) {
						console.log(
							`[Apply-React] per-file entrypoints: vendor=${vendorEntries.length} runtime=${virtualRuntimeEntrypoints.length} mod=${modEntries.length}`,
						);
					}
					return {
						entrypoints: [
							...vendorEntries,
							...virtualRuntimeEntrypoints,
							...modEntries,
						],
						splitting: false,
						files,
						plugins: [applyReactBuildPlugin],
					};
				}

				return {
					entrypoints: [
						...virtualRuntimeEntrypoints,
						...createEntrypoints(getRoutes()),
					],
					splitting: true,
					files,
					plugins: [applyReactBuildPlugin],
				};
			},
			async afterBuild(_config, result) {
				// Bun keeps bare "react/…" when external — browsers need absolute URLs.
				if (perFileGraph && result?.outputs?.length) {
					await Promise.all(
						result.outputs.map(async (out: { path: string }) => {
							if (!out.path.endsWith(".js")) return;
							try {
								const text = await Bun.file(out.path).text();
								if (!text.includes("from ") && !text.includes("import "))
									return;
								let next = rewriteBareReactImportsToUrls(text);
								// CJS vendor bodies assign to `React` after Bun turns
								// require("react") into `import * as React` — illegal ESM.
								next = fixExternalReactCjsInterop(next);
								if (next !== text) {
									await Bun.write(out.path, next);
									if (debug) {
										console.log(
											`[Apply-React] rewrote react imports/interop in ${out.path}`,
										);
									}
								}
							} catch {
								// ignore missing/deleted artifacts
							}
						}),
					);

					// Failsafe: ensure vendor files exist at outdir root (/react.js, …)
					const outDir = liveOutDir;
					const stillMissing: string[] = [];
					for (const rel of REACT_VENDOR_ENTRYPOINTS) {
						if (!(await Bun.file(join(outDir, rel)).exists())) {
							stillMissing.push(rel);
						}
					}
					if (stillMissing.length > 0) {
						console.warn(
							`[Apply-React] missing React vendor outputs: ${stillMissing.join(", ")} — running fallback vendor build`,
						);
						try {
							const vendorFiles = reactVendorFiles();
							const entries = stillMissing.filter((k) => k in vendorFiles);
							if (entries.length > 0) {
								const fb = await Bun.build({
									entrypoints: entries,
									outdir: outDir,
									target: "browser",
									format: "esm",
									splitting: false,
									plugins: [
										{
											name: "apply-react-vendor-fallback",
											setup(b) {
												b.onResolve(
													{
														filter:
															/^(react\.js|react-dom\.js|react-dom\/client\.js|react\/jsx-runtime\.js|react\/jsx-dev-runtime\.js)$/,
													},
													(args) => {
														if (args.path in vendorFiles) {
															return {
																path: args.path,
																namespace: "apply-react-vendor-fb",
															};
														}
													},
												);
												b.onLoad(
													{
														filter: /.*/,
														namespace: "apply-react-vendor-fb",
													},
													(args) => ({
														contents: vendorFiles[args.path] ?? "",
														loader: "js",
													}),
												);
											},
										},
									],
								});
								if (!fb.success) {
									console.error(
										"[Apply-React] fallback vendor build failed",
										fb.logs,
									);
								} else if (debug) {
									console.log(
										"[Apply-React] fallback vendor outputs:",
										fb.outputs.map((o) => o.path),
									);
								}
							}
						} catch (e) {
							console.error("[Apply-React] fallback vendor build error", e);
						}
					}
				}
				hmr.handleAfterBuild();
			},
		},
		serverConfig: {
			routes: {
				"/@apply-react/mod/*": perFileGraph
					? (req) =>
							handleBuiltModRequest(req, {
								moduleRoots,
								getBuildOutDir: () => liveOutDir,
								onMissingArtifact: kickRebuildForMissingMod,
							})
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
					// Import map: rely on built HTML (ensureSingleImportMapInHtml in
					// finally("html")). Do not prepend a second map at runtime.
					reWriter
						.on("head", {
							element(element) {
								element.append(
									`<script src="/@apply-react/client-hydrate.js" type="module"></script>`,
									{ html: true },
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
