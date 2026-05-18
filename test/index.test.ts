import { describe, expect, test } from "bun:test";
import { getRoutePathnameFromFileChange } from "../src/index";

describe("getRoutePathnameFromFileChange", () => {
	test("accepts file change paths relative to the project root", () => {
		expect(
			getRoutePathnameFromFileChange(
				"/workspace/apply-react",
				"/workspace/apply-react/test/src/pages",
				"test/src/pages/sub/index.tsx",
			),
		).toBe("/sub");
	});

	test("accepts system-absolute file change paths", () => {
		expect(
			getRoutePathnameFromFileChange(
				"/workspace/apply-react",
				"/workspace/apply-react/test/src/pages",
				"/workspace/apply-react/test/src/pages/sub/[id].tsx",
			),
		).toBe("/sub/[id]");
	});

	test("ignores files outside the watched route directory", () => {
		expect(
			getRoutePathnameFromFileChange(
				"/workspace/apply-react",
				"/workspace/apply-react/test/src/pages",
				"test/src/client-shell.tsx",
			),
		).toBeNull();
	});
});
