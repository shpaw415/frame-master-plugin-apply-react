import { afterEach, describe, expect, test } from "bun:test";
import {
	createPluginTestEnv,
	type PluginTestEnv,
	withTempDir,
	writeFixture,
} from "frame-master/testing";
import ApplyReact from "../../src/index";

const NativeWebSocket =
	(
		globalThis as typeof globalThis & {
			__APPLY_REACT_NATIVE_WEBSOCKET__?: typeof WebSocket;
		}
	).__APPLY_REACT_NATIVE_WEBSOCKET__ ?? WebSocket;

describe("integration: HMR websocket", () => {
	let env: PluginTestEnv | undefined;

	afterEach(async () => {
		await env?.dispose();
		env = undefined;
	});

	test("ws connects and receives server-hello", async () => {
		await withTempDir(async (dir) => {
			await writeFixture(
				dir,
				"src/pages/index.tsx",
				`export default function Home() { return <h1>Home</h1>; }\n`,
			);
			await writeFixture(
				dir,
				"src/client-shell.tsx",
				`export default function Shell({ children }: { children: any }) { return children; }\n`,
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
							clientShellPath: "src/client-shell.tsx",
							enableHMR: true,
							hydration: "render",
						}),
					],
				});

				const base = env.baseUrl;
				expect(base).toBeTruthy();
				const wsUrl = base!.replace(/^http/, "ws") + "/_REACT_HMR/ws";

				const message = await new Promise<string>((resolve, reject) => {
					const ws = new NativeWebSocket(wsUrl);
					const timer = setTimeout(() => {
						ws.close();
						reject(new Error("timeout waiting for server-hello"));
					}, 10_000);
					ws.addEventListener("message", (ev) => {
						clearTimeout(timer);
						resolve(String(ev.data));
						ws.close();
					});
					ws.addEventListener("error", () => {
						clearTimeout(timer);
						reject(new Error("ws error"));
					});
				});

				const parsed = JSON.parse(message) as { type: string; v: number };
				expect(parsed.type).toBe("server-hello");
				expect(parsed.v).toBe(1);
			} finally {
				process.chdir(prev);
			}
		});
	}, 30_000);
});
