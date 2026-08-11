import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModuleRoot } from "../src/hmr/module-root";
import {
	fromModUrlPath,
	listModuleFiles,
	resolveBuiltModPath,
	resolveModFile,
	rewriteRelativeImportsToModUrls,
	toModUrl,
	toVirtualModEntry,
} from "../src/hmr/mod-server";

describe("resolveModuleRoot", () => {
	test("uses explicit moduleRoot", () => {
		const r = resolveModuleRoot("/proj", "src/pages", "app");
		expect(r.relative).toBe("app");
		expect(r.absolute).toBe(join("/proj", "app"));
	});

	test("infers parent of pages", () => {
		const r = resolveModuleRoot("/proj", "frontend/pages");
		expect(r.relative).toBe("frontend");
	});

	test("falls back to src when present", () => {
		const dir = mkdtempSync(join(tmpdir(), "ar-mod-"));
		try {
			mkdirSync(join(dir, "src"));
			const r = resolveModuleRoot(dir, "routes");
			expect(r.relative).toBe("src");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("mod urls", () => {
	test("public URL uses .js not source .tsx", () => {
		const root = "/proj/app";
		const file = "/proj/app/pages/index.tsx";
		const url = toModUrl(root, file);
		expect(url).toBe("/@apply-react/mod/pages/index.js");
		expect(fromModUrlPath(root, url)).toBe("/proj/app/pages/index.js");
	});

	test("encodes dynamic route brackets as .js", () => {
		const root = "/proj/src";
		const file = "/proj/src/pages/products/[productid].tsx";
		const url = toModUrl(root, file);
		expect(url).toBe(
			"/@apply-react/mod/pages/products/%5Bproductid%5D.js",
		);
	});

	test("virtual entry key preserves source extension and relative path", () => {
		const root = "/proj/src";
		const file = "/proj/src/pages/products/[productid].tsx";
		expect(toVirtualModEntry(root, file)).toBe(
			"@apply-react/mod/pages/products/[productid].tsx",
		);
	});

	test("resolveBuiltModPath decodes brackets under outdir", () => {
		const built = resolveBuiltModPath(
			"/proj/.frame-master/build",
			"/@apply-react/mod/pages/products/%5Bproductid%5D.js",
		);
		expect(built).toBe(
			"/proj/.frame-master/build/@apply-react/mod/pages/products/[productid].js",
		);
	});
});

describe("rewriteRelativeImportsToModUrls", () => {
	test("externalizes relative imports to stable .js mod urls", () => {
		const dir = mkdtempSync(join(tmpdir(), "ar-tp-"));
		try {
			mkdirSync(join(dir, "pages"), { recursive: true });
			writeFileSync(join(dir, "ctx.ts"), `export const Ctx = "ok";\n`);
			const page = join(dir, "pages/index.tsx");
			const source = `import { Ctx } from "../ctx";\nexport default function P() { return <div>{Ctx}</div>; }\n`;
			writeFileSync(page, source);
			const out = rewriteRelativeImportsToModUrls(source, page, dir);
			expect(out).toContain("/@apply-react/mod/ctx.js");
			expect(out).not.toContain('from "../ctx"');
			expect(out).not.toContain("ctx.ts");
			expect(resolveModFile(dir, "/@apply-react/mod/pages/index.js")).toBe(
				page,
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("listModuleFiles", () => {
	test("all mode lists every source under root", () => {
		const dir = mkdtempSync(join(tmpdir(), "ar-list-"));
		try {
			mkdirSync(join(dir, "pages"), { recursive: true });
			writeFileSync(join(dir, "ctx.ts"), "export const x = 1;\n");
			writeFileSync(
				join(dir, "pages/index.tsx"),
				"export default function P(){return null}\n",
			);
			const files = listModuleFiles(dir, "all");
			expect(files.sort()).toEqual(
				[join(dir, "ctx.ts"), join(dir, "pages/index.tsx")].sort(),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
