/**
 * Optional Bun.WebView end-to-end Fast Refresh regression.
 *
 * Skips when Chrome/Chromium is not installed (CI without browser).
 * When available: boots createPluginTestEnv, loads the page, edits the route
 * source "page 1" → "page 2" → "page 1", and asserts DOM text + hook state.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { FrameMasterPlugin } from "frame-master/plugin/types";
import {
	createPluginTestEnv,
	type PluginTestEnv,
	withTempDir,
	writeFixture,
} from "frame-master/testing";
import ApplyReact, { getRoutePathnameFromFileChange } from "../../src/index";

// The repository unit-test preload installs happy-dom. Restore Bun's native
// fetch/Response globals before createPluginTestEnv starts a real Bun server.
GlobalRegistrator.unregister();

const chromeCandidates = [
	process.env.BUN_CHROME_PATH,
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/opt/google/chrome/chrome",
	"/snap/bin/chromium",
].filter(Boolean) as string[];

async function resolveChromePath(): Promise<string | null> {
	for (const path of chromeCandidates) {
		if (await Bun.file(path).exists()) return path;
	}
	try {
		const probe = new Bun.WebView({ width: 100, height: 100 });
		probe.close?.();
		return "auto";
	} catch {
		return null;
	}
}

function pageSource(title: string) {
	return `import { useState } from "react";
export default function Home() {
  const [n, setN] = useState(0);
  return (
    <div>
      <h1 data-testid="title">${title}</h1>
      <button type="button" data-testid="inc" onClick={() => setN((v) => v + 1)}>{n}</button>
    </div>
  );
}
`;
}

async function writeApp(dir: string) {
	await writeFixture(dir, "src/pages/index.tsx", pageSource("page 1"));
	await writeFixture(
		dir,
		"src/client-shell.tsx",
		`export default function Shell({ children }: { children: any }) { return children; }\n`,
	);
	await writeFixture(
		dir,
		"index.html",
		`<!doctype html><html><head></head><body><div id="root"></div></body></html>\n`,
	);
	const nodeModules = join(dir, "node_modules");
	await mkdir(nodeModules, { recursive: true });
	await Promise.all(
		["react", "react-dom"].map((dependency) =>
			symlink(
				join(import.meta.dir, "../../node_modules", dependency),
				join(nodeModules, dependency),
			),
		),
	);
}

function servePlugin(outdir: string, entry: string): FrameMasterPlugin {
	return {
		name: "test-html-entry",
		version: "0.0.1",
		serverReady: async ({ builder }) => {
			await builder.build();
		},
		build: {
			buildConfig: {
				outdir,
				target: "browser",
				entrypoints: [entry],
			},
		},
		router: {
			request(master) {
				const path =
					master.URL.pathname === "/"
						? join(outdir, "index.html")
						: join(outdir, master.URL.pathname);
				if (!existsSync(path)) return;
				master.setResponse(Bun.file(path)).sendNow();
			},
		},
	};
}

describe("integration: Fast Refresh via Bun.WebView", () => {
	let env: PluginTestEnv | undefined;

	afterEach(async () => {
		await env?.dispose();
		env = undefined;
	});

	test("round-trips page title text including revert while keeping counter", async () => {
		const chrome = await resolveChromePath();
		if (!chrome) {
			console.warn(
				"[skip] Bun.WebView needs Chrome/Chromium (set BUN_CHROME_PATH)",
			);
			return;
		}

		await withTempDir(async (dir) => {
			await writeApp(dir);
			const outdir = join(dir, ".frame-master/build");
			const prev = process.cwd();
			process.chdir(dir);
			try {
				const applyReact = ApplyReact({
					style: "nextjs",
					route: "src/pages",
					clientShellPath: "src/client-shell.tsx",
					enableHMR: true,
					enableFastRefresh: true,
					hydration: "render",
				});
				env = await createPluginTestEnv({
					cwd: dir,
					startServer: true,
					config: { HTTPServer: { idleTimeout: 255 } },
					plugins: [applyReact, servePlugin(outdir, join(dir, "index.html"))],
				});

				const base = env.baseUrl;
				expect(base).toBeTruthy();
				expect(applyReact.onFileSystemChange).toBeFunction();

				const viewOpts: ConstructorParameters<typeof Bun.WebView>[0] = {
					width: 800,
					height: 600,
				};
				viewOpts.backend =
					chrome === "auto"
						? "chrome"
						: { type: "chrome", path: chrome, url: false };

				viewOpts.console = console;
				await using view = new Bun.WebView(viewOpts);
				await view.navigate(`${base}/`);

				const waitForTitle = async (expected: string, ms = 15_000) => {
					const deadline = Date.now() + ms;
					while (Date.now() < deadline) {
						const text = (await view.evaluate(
							`document.querySelector('[data-testid="title"]')?.textContent ?? ""`,
						)) as string;
						if (text === expected) return text;
						await Bun.sleep(100);
					}
					const final = (await view.evaluate(
						`document.querySelector('[data-testid="title"]')?.textContent ?? ""`,
					)) as string;
					throw new Error(
						`timeout waiting for title "${expected}", got "${final}"`,
					);
				};

				await waitForTitle("page 1");
				// RouterHost creates the WebSocket in an effect after the initial
				// render; do not publish the first edit before that transport exists.
				await Bun.sleep(250);

				await view.click('[data-testid="inc"]');
				await Bun.sleep(50);
				const counterAfterClick = (await view.evaluate(
					`document.querySelector('[data-testid="inc"]')?.textContent ?? ""`,
				)) as string;
				expect(counterAfterClick).toBe("1");

				const pagePath = join(dir, "src/pages/index.tsx");
				expect(
					getRoutePathnameFromFileChange(dir, join(dir, "src/pages"), pagePath),
				).toBe("/");
				const triggerHmr = async (title: string) => {
					await Bun.write(pagePath, pageSource(title));
					await applyReact.onFileSystemChange?.("change", pagePath, pagePath);
					await env?.builder.build();
					await waitForTitle(title, 20_000);
				};

				await triggerHmr("page 2");
				expect(
					await view.evaluate(
						`document.querySelector('[data-testid="inc"]')?.textContent ?? ""`,
					),
				).toBe("1");

				// The reported bug: revert to page 1 does not update DOM
				await triggerHmr("page 1");
				expect(
					await view.evaluate(
						`document.querySelector('[data-testid="inc"]')?.textContent ?? ""`,
					),
				).toBe("1");

				await triggerHmr("page");
				expect(
					await view.evaluate(
						`document.querySelector('[data-testid="inc"]')?.textContent ?? ""`,
					),
				).toBe("1");
			} finally {
				process.chdir(prev);
			}
		});
	}, 120_000);
});
