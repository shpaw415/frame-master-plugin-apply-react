import { describe, expect, test } from "bun:test";
import {
	extractImportSpecifiers,
	getRoutePathnameFromFileChange,
} from "../src/index";

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
