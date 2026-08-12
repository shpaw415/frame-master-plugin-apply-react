import { describe, expect, test } from "bun:test";
import {
	extractImportSpecifiers,
	getRoutePathnameFromFileChange,
	resolveWatchDirectories,
} from "../src/index";
import { createPluginTestEnv } from "frame-master/testing";

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

describe("extractImportSpecifiers", () => {
	test("extracts static, dynamic, and require import specifiers", () => {
		const source = `
			import thing from "./thing";
			import "./side-effect.css";
			export { foo } from "../shared/foo";
			const lazy = import("react");
			const mod = require("./legacy");
		`;

		expect(extractImportSpecifiers(source)).toEqual([
			"./thing",
			"../shared/foo",
			"./side-effect.css",
			"react",
			"./legacy",
		]);
	});

	test("supports type-only imports and de-duplicates repeated specifiers", () => {
		const source = `
			import type { Foo } from "./types";
			import { value } from "./same";
			import { other } from "./same";
			export type { Bar } from "./types";
		`;

		expect(extractImportSpecifiers(source)).toEqual(["./types", "./same"]);
	});
});

describe("resolveWatchDirectories", () => {
	test("returns defaults when HMR is enabled and no directories are provided", () => {
		expect(resolveWatchDirectories(true)).toEqual([".", "node_modules"]);
	});

	test("returns undefined when HMR is disabled", () => {
		expect(resolveWatchDirectories(false, ["src", "packages"])).toBeUndefined();
	});

	test("sanitizes and de-duplicates user-provided directories", () => {
		expect(
			resolveWatchDirectories(true, [" src ", "", "src", "packages"]),
		).toEqual(["src", "packages"]);
	});

	test("returns undefined when enabled but provided directories are empty", () => {
		expect(resolveWatchDirectories(true, ["", "  "])).toBeUndefined();
	});

	test("applies excludes after includes", () => {
		expect(
			resolveWatchDirectories(true, ["src", "node_modules"], ["node_modules"]),
		).toEqual(["src"]);
	});

	test("returns undefined when excludes remove all include directories", () => {
		expect(resolveWatchDirectories(true, ["src"], ["src"])).toBeUndefined();
	});

	test("handles exclude list sanitization and de-duplication", () => {
		expect(
			resolveWatchDirectories(
				true,
				["src", "node_modules", "src"],
				[" node_modules ", "", "node_modules"],
			),
		).toEqual(["src"]);
	});
});
