import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveModuleRoot } from "../src/hmr/module-root";
import {
	fromModUrlPath,
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
	test("round-trip path", () => {
		const root = "/proj/app";
		const file = "/proj/app/pages/index.tsx";
		const url = toModUrl(root, file);
		expect(url).toBe("/@apply-react/mod/pages/index.tsx");
		expect(fromModUrlPath(root, url)).toBe(file);
	});

	test("encodes dynamic route brackets", () => {
		const root = "/proj/src";
		const file = "/proj/src/pages/products/[productid].tsx";
		const url = toModUrl(root, file);
		expect(url).toBe(
			"/@apply-react/mod/pages/products/%5Bproductid%5D.tsx",
		);
		expect(fromModUrlPath(root, url)).toBe(file);
	});
});

describe("transpileModFile", () => {
	test("externalizes relative imports to stable mod urls", async () => {
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
				expect(out.code).toContain("/@apply-react/mod/ctx");
				expect(out.code).not.toContain('from "../ctx"');
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
