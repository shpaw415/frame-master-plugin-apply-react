import { describe, expect, test } from "bun:test";
import { decideHotApply, hashHmrSource } from "../src/hmr-apply";

describe("hashHmrSource", () => {
	test("is stable for the same source and changes when source changes", () => {
		expect(hashHmrSource("page 1")).toBe(hashHmrSource("page 1"));
		expect(hashHmrSource("page 1")).not.toBe(hashHmrSource("page 2"));
	});
});

describe("decideHotApply", () => {
	const pageA = function PageA() {};
	const pageB = function PageB() {};

	test("skips updates that are not for the active route", () => {
		expect(
			decideHotApply({
				fastRefreshEnabled: true,
				isActiveRoute: false,
				previousType: pageA,
				nextType: pageB,
				sourceHash: "b",
				lastAppliedHash: "a",
			}),
		).toBe("skip");
	});

	test("remounts when Fast Refresh is disabled", () => {
		expect(
			decideHotApply({
				fastRefreshEnabled: false,
				isActiveRoute: true,
				previousType: pageA,
				nextType: pageB,
			}),
		).toBe("remount");
	});

	test("refreshes when the component type changes", () => {
		expect(
			decideHotApply({
				fastRefreshEnabled: true,
				isActiveRoute: true,
				previousType: pageA,
				nextType: pageB,
				sourceHash: "b",
				lastAppliedHash: "a",
			}),
		).toBe("refresh");
	});

	test("reloads when a new hash reuses the same module identity", () => {
		expect(
			decideHotApply({
				fastRefreshEnabled: true,
				isActiveRoute: true,
				previousType: pageA,
				nextType: pageA,
				sourceHash: "b",
				lastAppliedHash: "a",
			}),
		).toBe("reload");
	});

	test("skips duplicate hashes", () => {
		expect(
			decideHotApply({
				fastRefreshEnabled: true,
				isActiveRoute: true,
				previousType: pageA,
				nextType: pageA,
				sourceHash: "a",
				lastAppliedHash: "a",
			}),
		).toBe("skip");
	});

	test("refreshes same identity when no source hash is provided", () => {
		expect(
			decideHotApply({
				fastRefreshEnabled: true,
				isActiveRoute: true,
				previousType: pageA,
				nextType: pageA,
			}),
		).toBe("refresh");
	});
});
