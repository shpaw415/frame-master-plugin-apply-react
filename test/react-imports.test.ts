import { describe, expect, test } from "bun:test";
import {
	htmlHasImportMap,
	importMapScriptTag,
	injectImportMapIntoHtml,
	rewriteBareReactImportsToUrls,
} from "../src/hmr/react-imports";

describe("rewriteBareReactImportsToUrls", () => {
	test("rewrites jsx-dev-runtime from import", () => {
		const src = `import { jsxDEV } from "react/jsx-dev-runtime";\nexport const x = 1;\n`;
		const out = rewriteBareReactImportsToUrls(src);
		expect(out).toContain('from "/react/jsx-dev-runtime.js"');
		expect(out).not.toContain('from "react/jsx-dev-runtime"');
	});

	test("rewrites react and react-dom/client", () => {
		const src = `
import { useState } from "react";
import { createRoot } from 'react-dom/client';
import { createElement } from "react-dom";
`;
		const out = rewriteBareReactImportsToUrls(src);
		expect(out).toContain('from "/react.js"');
		expect(out).toContain("from '/react-dom/client.js'");
		expect(out).toContain('from "/react-dom.js"');
	});

	test("rewrites dynamic import", () => {
		const src = `const m = await import("react/jsx-runtime");\n`;
		const out = rewriteBareReactImportsToUrls(src);
		expect(out).toContain('import("/react/jsx-runtime.js")');
	});

	test("leaves unrelated imports alone", () => {
		const src = `import x from "./local";\nimport y from "lodash";\n`;
		expect(rewriteBareReactImportsToUrls(src)).toBe(src);
	});
});

describe("importMapScriptTag", () => {
	test("includes jsx-dev-runtime mapping and stable id", () => {
		const tag = importMapScriptTag();
		expect(tag).toContain('type="importmap"');
		expect(tag).toContain('id="__apply_react_importmap__"');
		expect(tag).toContain("react/jsx-dev-runtime");
		expect(tag).toContain("/react/jsx-dev-runtime.js");
	});
});

describe("injectImportMapIntoHtml", () => {
	test("injects immediately after <head>", () => {
		const html = `<!doctype html><html><head><title>t</title>
<script type="module" src="/app.js"></script></head><body></body></html>`;
		const out = injectImportMapIntoHtml(html);
		expect(htmlHasImportMap(out)).toBe(true);
		const headIdx = out.toLowerCase().indexOf("<head>");
		const mapIdx = out.indexOf("__apply_react_importmap__");
		const modIdx = out.indexOf('type="module"');
		expect(mapIdx).toBeGreaterThan(headIdx);
		expect(mapIdx).toBeLessThan(modIdx);
	});

	test("is idempotent", () => {
		const html = `<html><head></head></html>`;
		const once = injectImportMapIntoHtml(html);
		const twice = injectImportMapIntoHtml(once);
		expect(twice).toBe(once);
		expect(twice.split("__apply_react_importmap__").length - 1).toBe(1);
	});

	test("creates head when only html tag present", () => {
		const out = injectImportMapIntoHtml(`<html><body>x</body></html>`);
		expect(out).toContain("<head>");
		expect(htmlHasImportMap(out)).toBe(true);
	});
});
