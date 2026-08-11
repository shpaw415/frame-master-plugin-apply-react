/**
 * Integration: Frame-Master 3.2.2+ createPluginTestEnv — multi-entrypoint per-file graph.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
	createPluginTestEnv,
	type PluginTestEnv,
	withTempDir,
	writeFixture,
} from "frame-master/testing";
import type { FrameMasterPlugin } from "frame-master/plugin";
import ApplyReact from "../../src/index";

// Always use Bun's fetch — happy-dom patches globalThis.fetch in unit tests.
const nativeFetch: typeof fetch = Bun.fetch.bind(Bun);

const REPO_ROOT = join(import.meta.dir, "../..");

/** Temp fixtures need react/react-dom resolvable for multi-entrypoint builds. */
function linkRepoNodeModules(dir: string) {
	const target = join(REPO_ROOT, "node_modules");
	const link = join(dir, "node_modules");
	if (!existsSync(link) && existsSync(target)) {
		symlinkSync(target, link, "dir");
	}
}

async function writeMinimalApp(dir: string) {
	linkRepoNodeModules(dir);
	await writeFixture(
		dir,
		"src/pages/index.tsx",
		`export default function Home() { return <h1>Home</h1>; }\n`,
	);
	await writeFixture(
		dir,
		"src/pages/about.tsx",
		`export default function About() { return <h1>About</h1>; }\n`,
	);
	await writeFixture(
		dir,
		"src/client-shell.tsx",
		`export default function Shell({ children }: { children: any }) { return children; }\n`,
	);
}

function stampPlugin(moduleRootAbsHint = "src"): FrameMasterPlugin {
	return {
		name: "fixture-stamp-onload",
		version: "0.0.0",
		build: {
			buildConfig: {
				plugins: [
					{
						name: "fixture-stamp",
						setup(build) {
							build.onLoad({ filter: /\.tsx$/ }, async (args) => {
								// Only real on-disk app sources (skip virtual @apply-react/* keys)
								if (
									args.path.startsWith("@") ||
									!args.path.includes(moduleRootAbsHint) ||
									!(await Bun.file(args.path).exists())
								) {
									return undefined;
								}
								const text = await Bun.file(args.path).text();
								if (!args.path.replace(/\\/g, "/").includes("/pages/index.")) {
									return { contents: text, loader: "tsx" };
								}
								return {
									contents: `${text}\nexport const __STAMP__ = "OTHER_PLUGIN_OK";\n`,
									loader: "tsx",
								};
							});
						},
					},
				],
			},
		},
	};
}

describe("integration: apply-react boot + multi-entrypoint mod", () => {
	let env: PluginTestEnv | undefined;

	afterEach(async () => {
		await env?.dispose();
		env = undefined;
	});

	test("plugin loads in createPluginTestEnv", async () => {
		await withTempDir(async (dir) => {
			await writeMinimalApp(dir);
			const prev = process.cwd();
			process.chdir(dir);
			try {
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					plugins: [
						ApplyReact({
							style: "nextjs",
							route: "src/pages",
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
						}),
					],
				});

				expect(
					env.pluginLoader
						.getPlugins()
						.some((p) => String(p.name).includes("apply-react")),
				).toBe(true);
				expect(env.baseUrl).toBeTruthy();
			} finally {
				process.chdir(prev);
			}
		});
	}, 60_000);

	test("per-file build emits mod artifacts and serves them", async () => {
		await withTempDir(async (dir) => {
			await writeMinimalApp(dir);
			await writeFixture(
				dir,
				"src/ctx.ts",
				`export const marker = "context-ok";\n`,
			);
			await writeFixture(
				dir,
				"src/pages/index.tsx",
				`import { marker } from "../ctx";\nexport default function Home() { return <h1>{marker}</h1>; }\n`,
			);
			const prev = process.cwd();
			process.chdir(dir);
			try {
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					plugins: [
						ApplyReact({
							style: "nextjs",
							route: "src/pages",
							moduleRoot: "src",
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
							hmr: { moduleGraph: "per-file", entrypointMode: "all" },
						}),
					],
				});

				// Ensure multi-entrypoint build has run
				const builder = env.builder;
				if (builder && !builder.isBuilding()) {
					await builder.build();
				} else if (builder?.isBuilding()) {
					await builder.awaitBuildFinish();
				}

				const artifact = join(
					dir,
					".frame-master/build/@apply-react/mod/pages/index.js",
				);
				const ctxArtifact = join(
					dir,
					".frame-master/build/@apply-react/mod/ctx.js",
				);
				expect(existsSync(artifact)).toBe(true);
				expect(existsSync(ctxArtifact)).toBe(true);

				const base = env.baseUrl!;
				const res = await nativeFetch(
					`${base}/@apply-react/mod/pages/index.js`,
				);
				expect(res.status).toBe(200);
				const code = await res.text();
				expect(code).toContain("/@apply-react/mod/ctx.js");
				expect(code).not.toContain('from "../ctx"');
			} finally {
				process.chdir(prev);
			}
		});
	}, 90_000);

	test("other plugin onLoad runs on page sources during build", async () => {
		await withTempDir(async (dir) => {
			await writeMinimalApp(dir);
			const prev = process.cwd();
			process.chdir(dir);
			try {
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					plugins: [
						stampPlugin(),
						ApplyReact({
							style: "nextjs",
							route: "src/pages",
							moduleRoot: "src",
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
							hmr: { moduleGraph: "per-file", entrypointMode: "all" },
						}),
					],
				});

				const builder = env.builder;
				if (builder && !builder.isBuilding()) {
					await builder.build();
				} else if (builder?.isBuilding()) {
					await builder.awaitBuildFinish();
				}

				const artifact = join(
					dir,
					".frame-master/build/@apply-react/mod/pages/index.js",
				);
				expect(existsSync(artifact)).toBe(true);
				const code = await Bun.file(artifact).text();
				expect(code).toContain("OTHER_PLUGIN_OK");
			} finally {
				process.chdir(prev);
			}
		});
	}, 90_000);

	test("dynamic route encoded URL serves built [param] artifact", async () => {
		await withTempDir(async (dir) => {
			await writeMinimalApp(dir);
			await writeFixture(
				dir,
				"src/pages/products/[productid].tsx",
				`export default function Product() { return <h1>P</h1>; }\n`,
			);
			const prev = process.cwd();
			process.chdir(dir);
			try {
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					plugins: [
						ApplyReact({
							style: "nextjs",
							route: "src/pages",
							moduleRoot: "src",
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
							hmr: { moduleGraph: "per-file", entrypointMode: "all" },
						}),
					],
				});

				const builder = env.builder;
				if (builder && !builder.isBuilding()) {
					await builder.build();
				} else if (builder?.isBuilding()) {
					await builder.awaitBuildFinish();
				}

				const disk = join(
					dir,
					".frame-master/build/@apply-react/mod/pages/products/[productid].js",
				);
				expect(existsSync(disk)).toBe(true);

				const base = env.baseUrl!;
				const res = await nativeFetch(
					`${base}/@apply-react/mod/pages/products/%5Bproductid%5D.js`,
				);
				expect(res.status).toBe(200);
				const code = await res.text();
				expect(code).toContain("Product");
			} finally {
				process.chdir(prev);
			}
		});
	}, 90_000);

	test("missing mod artifact returns 404 (no live transpile)", async () => {
		await withTempDir(async (dir) => {
			await writeMinimalApp(dir);
			const prev = process.cwd();
			process.chdir(dir);
			try {
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					plugins: [
						ApplyReact({
							style: "nextjs",
							route: "src/pages",
							moduleRoot: "src",
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
							hmr: { moduleGraph: "per-file" },
						}),
					],
				});

				const base = env.baseUrl!;
				const res = await nativeFetch(
					`${base}/@apply-react/mod/pages/does-not-exist.js`,
				);
				expect(res.status).toBe(404);
				const body = await res.text();
				expect(body).toContain("module not in last build");
			} finally {
				process.chdir(prev);
			}
		});
	}, 60_000);

	test("HMR build-route API responds", async () => {
		await withTempDir(async (dir) => {
			await writeMinimalApp(dir);
			const prev = process.cwd();
			process.chdir(dir);
			try {
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					plugins: [
						ApplyReact({
							style: "nextjs",
							route: "src/pages",
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
						}),
					],
				});

				const base = env.baseUrl!;
				const missing = await nativeFetch(
					`${base}/_REACT_HMR/build-route?pathname=${encodeURIComponent("/nope")}`,
				);
				expect(missing.status).toBe(404);
				const missingJson = (await missing.json()) as { status: string };
				expect(missingJson.status).toBe("missing");

				const bad = await nativeFetch(`${base}/_REACT_HMR/build-route`);
				expect(bad.status).toBe(400);

				const building = await nativeFetch(
					`${base}/_REACT_HMR/build-route?pathname=${encodeURIComponent("/")}`,
				);
				expect([202, 500]).toContain(building.status);
				if (building.status === 202) {
					const json = (await building.json()) as {
						status: string;
						routeName: string;
						generation: number;
					};
					expect(json.status).toBe("building");
					expect(json.routeName).toBeTruthy();
					expect(typeof json.generation).toBe("number");
				}
			} finally {
				process.chdir(prev);
			}
		});
	}, 60_000);
});
