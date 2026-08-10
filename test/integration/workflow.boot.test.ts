/**
 * Integration: Frame-Master 3.2.2+ createPluginTestEnv — plugin boot + HMR HTTP.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	createPluginTestEnv,
	type PluginTestEnv,
	withTempDir,
	writeFixture,
} from "frame-master/testing";
import ApplyReact from "../../src/index";

// Always use Bun's fetch — happy-dom patches globalThis.fetch in unit tests.
const nativeFetch: typeof fetch = Bun.fetch.bind(Bun);

async function writeMinimalApp(dir: string) {
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

describe("integration: apply-react boot + HMR HTTP", () => {
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

	test("per-file mod endpoint serves transpiled modules", async () => {
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
							hmr: { moduleGraph: "per-file" },
						}),
					],
				});
				const base = env.baseUrl!;
				const res = await nativeFetch(
					`${base}/@apply-react/mod/pages/index.tsx`,
				);
				expect(res.status).toBe(200);
				const code = await res.text();
				expect(code).toContain("/@apply-react/mod/ctx");
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
