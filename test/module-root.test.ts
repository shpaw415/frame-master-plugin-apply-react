import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	compileEntrypointExclude,
	matchesEntrypointExclude,
	resolveModuleRoot,
	resolveModuleRoots,
	toModPublicRel,
} from "../src/hmr/module-root";
import {
	fromModUrlPath,
	listModuleFiles,
	resolveBuiltModPath,
	resolveModFile,
	rewriteRelativeImportsToModUrls,
	toModUrl,
	toVirtualModEntry,
} from "../src/hmr/mod-server";

describe("resolveModuleRoot / resolveModuleRoots", () => {
	test("uses explicit moduleRoot string", () => {
		const r = resolveModuleRoot("/proj", "src/pages", "app");
		expect(r.relative).toBe("app");
		expect(r.absolute).toBe(join("/proj", "app"));
	});

	test("accepts moduleRoot array", () => {
		const roots = resolveModuleRoots("/proj", "src/pages", ["src", "lib"]);
		expect(roots.map((r) => r.relative)).toEqual(["src", "lib"]);
		expect(roots.map((r) => r.absolute)).toEqual([
			join("/proj", "src"),
			join("/proj", "lib"),
		]);
	});

	test("dedupes overlapping moduleRoot entries", () => {
		const roots = resolveModuleRoots("/proj", "src/pages", [
			"src",
			"./src/",
			"lib",
		]);
		expect(roots.map((r) => r.relative)).toEqual(["src", "lib"]);
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

	test("multi-root public paths are prefixed with root relative", () => {
		const roots = resolveModuleRoots("/proj", "src/pages", ["src", "lib"]);
		const file = join("/proj", "lib", "button.tsx");
		expect(toModPublicRel(roots, file)).toBe("lib/button.tsx");
		expect(toModUrl(roots, file)).toBe("/@apply-react/mod/lib/button.js");
		expect(resolveModFile(roots, "/@apply-react/mod/lib/button.js")).toBe(
			null,
		); // no disk
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

	test("entrypointExclude drops matching files", () => {
		const dir = mkdtempSync(join(tmpdir(), "ar-ex-"));
		try {
			mkdirSync(join(dir, "pages"), { recursive: true });
			writeFileSync(join(dir, "ctx.ts"), "export const x = 1;\n");
			writeFileSync(
				join(dir, "pages/index.tsx"),
				"export default function P(){return null}\n",
			);
			writeFileSync(
				join(dir, "pages/index.test.tsx"),
				"export default function T(){return null}\n",
			);
			const files = listModuleFiles(dir, "all", [], {
				cwd: dir,
				entrypointExclude: [/\.test\.[tj]sx?$/],
			});
			expect(files.sort()).toEqual(
				[join(dir, "ctx.ts"), join(dir, "pages/index.tsx")].sort(),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("multi-root lists files from every root", () => {
		const dir = mkdtempSync(join(tmpdir(), "ar-multi-"));
		try {
			mkdirSync(join(dir, "src/pages"), { recursive: true });
			mkdirSync(join(dir, "lib"), { recursive: true });
			writeFileSync(
				join(dir, "src/pages/index.tsx"),
				"export default function P(){return null}\n",
			);
			writeFileSync(join(dir, "lib/util.ts"), "export const u = 1;\n");
			const roots = resolveModuleRoots(dir, "src/pages", ["src", "lib"]);
			const files = listModuleFiles(roots, "all", [], { cwd: dir });
			expect(files.sort()).toEqual(
				[
					join(dir, "lib/util.ts"),
					join(dir, "src/pages/index.tsx"),
				].sort(),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("entrypointExclude helpers", () => {
	test("compileEntrypointExclude accepts strings and RegExp", () => {
		const re = compileEntrypointExclude([/\.stories\./, String.raw`/mocks/`]);
		expect(re).toHaveLength(2);
		expect(re[0]!.test("Button.stories.tsx")).toBe(true);
		expect(re[1]!.test("src/mocks/data.ts")).toBe(true);
	});

	test("matchesEntrypointExclude checks public rel", () => {
		const roots = resolveModuleRoots("/proj", "src/pages", "src");
		const exclude = compileEntrypointExclude([/pages\/secret/]);
		expect(
			matchesEntrypointExclude(
				"/proj/src/pages/secret.tsx",
				roots,
				"/proj",
				exclude,
			),
		).toBe(true);
		expect(
			matchesEntrypointExclude(
				"/proj/src/pages/index.tsx",
				roots,
				"/proj",
				exclude,
			),
		).toBe(false);
	});
});
