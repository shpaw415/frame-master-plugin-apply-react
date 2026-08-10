import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModuleRoot } from "../src/hmr/module-root";
import {
	fromModUrlPath,
	resolveModFile,
	toModUrl,
	transpileModFile,
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
		// fromModUrlPath returns the .js path; resolveModFile maps to source
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
});

describe("transpileModFile", () => {
	test("externalizes relative imports to stable .js mod urls", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ar-tp-"));
		try {
			mkdirSync(join(dir, "pages"), { recursive: true });
			writeFileSync(
				join(dir, "ctx.ts"),
				`export const Ctx = "ok";\n`,
			);
			writeFileSync(
				join(dir, "pages/index.tsx"),
				`import { Ctx } from "../ctx";\nexport default function P() { return <div>{Ctx}</div>; }\n`,
			);
			const out = await transpileModFile(join(dir, "pages/index.tsx"), dir);
			expect("code" in out).toBe(true);
			if ("code" in out) {
				expect(out.code).toContain("/@apply-react/mod/ctx.js");
				expect(out.code).not.toContain('from "../ctx"');
				expect(out.code).not.toContain("ctx.ts");
			}
			// .js URL resolves back to source .tsx
			expect(
				resolveModFile(dir, "/@apply-react/mod/pages/index.js"),
			).toBe(join(dir, "pages/index.tsx"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
