/**
 * Regression: Fast Refresh must update rendered text on every edit, including
 * reverting to a previous string ("page 1" → "page 2" → "page 1").
 *
 * This test exercises the refresh runtime path end-to-end (register +
 * performReactRefresh) while the browser workflow is covered manually against
 * the example app.
 *
 * IMPORTANT: injectIntoGlobalHook must run before react-dom/client is imported.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import RefreshRuntime from "react-refresh/runtime";

RefreshRuntime.injectIntoGlobalHook(globalThis);
(
	globalThis as typeof globalThis & {
		$RefreshReg$?: (type: unknown, id: string) => void;
		$RefreshSig$?: unknown;
	}
).$RefreshReg$ = () => {};
(globalThis as typeof globalThis & { $RefreshSig$?: unknown }).$RefreshSig$ =
	RefreshRuntime.createSignatureFunctionForTransform;

const { useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;

import { resolveChunkNamingPattern } from "../src/index";

function flush() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function registerDefault(moduleId: string, type: unknown) {
	RefreshRuntime.register(type, `${moduleId} default`);
}

function makePage(text: string) {
	function Page() {
		const [n, setN] = useState(0);
		return (
			<div>
				<h1 data-testid="title">{text}</h1>
				<button
					type="button"
					data-testid="inc"
					onClick={() => setN((v) => v + 1)}
				>
					{n}
				</button>
			</div>
		);
	}
	Page.displayName = "Page";
	return Page;
}

describe("resolveChunkNamingPattern", () => {
	test("creates a production cache-busting chunk pattern", () => {
		const a = resolveChunkNamingPattern(1_700_000_000_000);
		const b = resolveChunkNamingPattern(1_700_000_000_001);
		expect(a).toBe("chunk-[hash]-1700000000000.[ext]");
		expect(b).toBe("chunk-[hash]-1700000000001.[ext]");
		expect(a).not.toBe(b);
	});

	test("never uses bare content-hash-only naming", () => {
		expect(resolveChunkNamingPattern(42)).not.toBe("chunk-[hash].[ext]");
		expect(resolveChunkNamingPattern(42)).toContain("42");
	});
});

describe("Fast Refresh content round-trip", () => {
	let root: Root | undefined;
	let container: HTMLDivElement;
	const moduleId = "test/pages/index.tsx";

	beforeEach(() => {
		document.body.innerHTML = '<div id="root"></div>';
		container = document.getElementById("root") as HTMLDivElement;
	});

	afterEach(async () => {
		if (root) {
			await act(async () => {
				root?.unmount();
				await flush();
			});
		}
		document.body.innerHTML = "";
	});

	test("updates h1 text on edit and on revert while keeping useState", async () => {
		const V1 = makePage("page 1");
		registerDefault(moduleId, V1);

		await act(async () => {
			root = createRoot(container);
			root.render(<V1 />);
			await flush();
		});

		expect(container.querySelector("[data-testid='title']")?.textContent).toBe(
			"page 1",
		);

		const inc = container.querySelector(
			"[data-testid='inc']",
		) as HTMLButtonElement;
		await act(async () => {
			inc.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
			await flush();
		});
		expect(inc.textContent).toBe("1");

		// Edit: page 1 → page 2
		registerDefault(moduleId, makePage("page 2"));
		await act(async () => {
			RefreshRuntime.performReactRefresh();
			await flush();
			await flush();
		});
		expect(container.querySelector("[data-testid='title']")?.textContent).toBe(
			"page 2",
		);
		expect(container.querySelector("[data-testid='inc']")?.textContent).toBe(
			"1",
		);

		// Revert: page 2 → page 1 (the flaky case when chunk URLs collide)
		registerDefault(moduleId, makePage("page 1"));
		await act(async () => {
			RefreshRuntime.performReactRefresh();
			await flush();
			await flush();
		});
		expect(container.querySelector("[data-testid='title']")?.textContent).toBe(
			"page 1",
		);
		expect(container.querySelector("[data-testid='inc']")?.textContent).toBe(
			"1",
		);

		// Another prior-like string
		registerDefault(moduleId, makePage("page"));
		await act(async () => {
			RefreshRuntime.performReactRefresh();
			await flush();
			await flush();
		});
		expect(container.querySelector("[data-testid='title']")?.textContent).toBe(
			"page",
		);
		expect(container.querySelector("[data-testid='inc']")?.textContent).toBe(
			"1",
		);
	});
});
