import { describe, expect, test } from "bun:test";
import { extractImportSpecifiers } from "../src/hmr/deps";

describe("extractImportSpecifiers", () => {
	test("finds static and dynamic imports", () => {
		const source = `
			import React from "react";
			import { x } from "./local";
			export { y } from "../y";
			const z = await import("./z");
			require("./cjs");
		`;
		const specs = extractImportSpecifiers(source);
		expect(specs).toContain("react");
		expect(specs).toContain("./local");
		expect(specs).toContain("../y");
		expect(specs).toContain("./z");
		expect(specs).toContain("./cjs");
	});
});
