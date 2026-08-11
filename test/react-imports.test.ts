import { describe, expect, test } from "bun:test";
import {
	ensureSingleImportMapInHtml,
	htmlHasImportMap,
	htmlHasOurImportMap,
	importMapScriptTag,
	mergeImportMaps,
	parseImportMapScripts,
	REACT_BARE_TO_URL,
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

describe("ensureSingleImportMapInHtml", () => {
	test("injects immediately after <head>", () => {
		const html = `<!doctype html><html><head><title>t</title>
<script type="module" src="/app.js"></script></head><body></body></html>`;
		const out = ensureSingleImportMapInHtml(html);
		expect(htmlHasImportMap(out)).toBe(true);
		expect(htmlHasOurImportMap(out)).toBe(true);
		const headIdx = out.toLowerCase().indexOf("<head>");
		const mapIdx = out.indexOf("__apply_react_importmap__");
		const modIdx = out.indexOf('type="module"');
		expect(mapIdx).toBeGreaterThan(headIdx);
		expect(mapIdx).toBeLessThan(modIdx);
		expect(parseImportMapScripts(out)).toHaveLength(1);
	});

	test("is idempotent when already canonical", () => {
		const html = `<html><head></head></html>`;
		const once = ensureSingleImportMapInHtml(html);
		const twice = ensureSingleImportMapInHtml(once);
		expect(parseImportMapScripts(twice)).toHaveLength(1);
		expect(twice.split("type=\"importmap\"").length - 1).toBe(1);
	});

	test("creates head when only html tag present", () => {
		const out = ensureSingleImportMapInHtml(`<html><body>x</body></html>`);
		expect(out).toContain("<head>");
		expect(htmlHasImportMap(out)).toBe(true);
	});

	test("merges foreign import map and keeps one tag", () => {
		const html = `<html><head>
<script type="importmap">{"imports":{"lodash":"/vendor/lodash.js","react":"/old-react.js"}}</script>
<script type="module" src="/app.js"></script>
</head></html>`;
		const out = ensureSingleImportMapInHtml(html);
		const maps = parseImportMapScripts(out);
		expect(maps).toHaveLength(1);
		expect(maps[0]!.imports.lodash).toBe("/vendor/lodash.js");
		// our react keys win
		expect(maps[0]!.imports.react).toBe(REACT_BARE_TO_URL.react);
		expect(maps[0]!.imports["react/jsx-dev-runtime"]).toBe(
			REACT_BARE_TO_URL["react/jsx-dev-runtime"],
		);
		expect(maps[0]!.isOurs).toBe(true);
	});

	test("collapses two import maps into one", () => {
		const html = `<html><head>
<script type="importmap">{"imports":{"a":"/a.js"}}</script>
<script type="importmap" id="__apply_react_importmap__">{"imports":{"react":"/react.js"}}</script>
</head></html>`;
		const out = ensureSingleImportMapInHtml(html);
		expect(parseImportMapScripts(out)).toHaveLength(1);
		expect(out.split(/type\s*=\s*["']importmap["']/i).length - 1).toBe(1);
		const imports = parseImportMapScripts(out)[0]!.imports;
		expect(imports.a).toBe("/a.js");
		expect(imports.react).toBe("/react.js");
	});

	test("replaces ours with full react key set", () => {
		const html = `<html><head>
<script type="importmap" id="__apply_react_importmap__" data-apply-react-importmap="1">{"imports":{"react":"/react.js"}}</script>
</head></html>`;
		const out = ensureSingleImportMapInHtml(html);
		const imports = parseImportMapScripts(out)[0]!.imports;
		expect(imports["react/jsx-dev-runtime"]).toBe(
			"/react/jsx-dev-runtime.js",
		);
		expect(imports["react-dom/client"]).toBe("/react-dom/client.js");
	});
});

describe("mergeImportMaps", () => {
	test("later maps override earlier; ours overlay last", () => {
		const m = mergeImportMaps(
			[{ react: "/old.js", foo: "/foo.js" }, { foo: "/foo2.js" }],
			{ react: "/react.js" },
		);
		expect(m.foo).toBe("/foo2.js");
		expect(m.react).toBe("/react.js");
	});
});
