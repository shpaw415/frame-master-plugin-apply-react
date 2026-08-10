import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const APP_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
]);

const RESOLVE_EXTENSIONS = [
	".tsx",
	".ts",
	".jsx",
	".js",
	".mjs",
	".cjs",
	".json",
];

export function isAppSourceFile(filePath: string): boolean {
	return APP_EXTENSIONS.has(extname(filePath));
}

export function listModuleFiles(
	moduleRootAbs: string,
	mode: "all" | "reachable",
	seeds: string[] = [],
): string[] {
	if (mode === "all") {
		return walkDir(moduleRootAbs).filter(isAppSourceFile);
	}

	const syncQueue = seeds.map((s) => resolve(s)).filter(existsSync);
	const out = new Set<string>();
	while (syncQueue.length) {
		const current = syncQueue.pop()!;
		const norm = resolve(current);
		if (out.has(norm)) continue;
		if (!norm.startsWith(moduleRootAbs)) continue;
		if (!existsSync(norm)) continue;
		if (!isAppSourceFile(norm)) continue;
		out.add(norm);
		const text = readFileSyncSafe(norm);
		if (!text) continue;
		for (const spec of extractRelativeSpecifiers(text)) {
			const resolved = resolveSpecifier(norm, spec, moduleRootAbs);
			if (resolved) syncQueue.push(resolved);
		}
	}
	if (out.size === 0) {
		return walkDir(moduleRootAbs).filter(isAppSourceFile);
	}
	return [...out];
}

function readFileSyncSafe(path: string): string | null {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return null;
	}
}

function walkDir(dir: string): string[] {
	const results: string[] = [];
	if (!existsSync(dir)) return results;
	for (const name of readdirSync(dir)) {
		if (name === "node_modules" || name === ".git" || name === ".frame-master")
			continue;
		const p = join(dir, name);
		try {
			const st = statSync(p);
			if (st.isDirectory()) results.push(...walkDir(p));
			else results.push(p);
		} catch {
			// ignore
		}
	}
	return results;
}

const REL_IMPORT_RE =
	/(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["'](\.[^"']+)["']|import\s*\(\s*["'](\.[^"']+)["']\s*\)|import\s+["'](\.[^"']+)["']/g;

function extractRelativeSpecifiers(source: string): string[] {
	const specs = new Set<string>();
	for (const match of source.matchAll(REL_IMPORT_RE)) {
		const s = match[1] || match[2] || match[3];
		if (s) specs.add(s);
	}
	return [...specs];
}

function resolveSpecifier(
	fromFile: string,
	spec: string,
	moduleRootAbs: string,
): string | null {
	const base = resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		...RESOLVE_EXTENSIONS.map((e) => base + e),
		...RESOLVE_EXTENSIONS.map((e) => join(base, `index${e}`)),
	];
	for (const c of candidates) {
		if (existsSync(c) && c.startsWith(moduleRootAbs)) return c;
	}
	return null;
}

/** Encode moduleRoot-relative path for use in `/@apply-react/mod/...` URLs. */
export function encodeModRelPath(rel: string): string {
	return rel
		.replace(/\\/g, "/")
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg))
		.join("/");
}

/**
 * Stable browser URL for a module under moduleRoot.
 * Path segments are encodeURIComponent'd so dynamic routes like `[id].tsx` work.
 */
export function toModUrl(moduleRootAbs: string, absoluteFile: string): string {
	const rel = relative(moduleRootAbs, absoluteFile).replace(/\\/g, "/");
	return `/@apply-react/mod/${encodeModRelPath(rel)}`;
}

export function fromModUrlPath(
	moduleRootAbs: string,
	urlPathname: string,
): string | null {
	const prefix = "/@apply-react/mod/";
	if (!urlPathname.startsWith(prefix)) return null;
	// Decode each segment (handles [id] → %5Bid%5D and plain paths)
	const rel = urlPathname
		.slice(prefix.length)
		.split("/")
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");
	if (!rel || rel.includes("..")) return null;
	const abs = resolve(moduleRootAbs, rel);
	if (!abs.startsWith(moduleRootAbs)) return null;
	return abs;
}

export function resolveModFile(
	moduleRootAbs: string,
	urlPathname: string,
): string | null {
	const abs = fromModUrlPath(moduleRootAbs, urlPathname);
	if (!abs) return null;
	if (existsSync(abs) && isAppSourceFile(abs)) return abs;
	for (const e of RESOLVE_EXTENSIONS) {
		if (existsSync(abs + e) && isAppSourceFile(abs + e)) return abs + e;
	}
	for (const e of RESOLVE_EXTENSIONS) {
		const idx = join(abs, `index${e}`);
		if (existsSync(idx)) return idx;
	}
	return existsSync(abs) ? abs : null;
}

function loaderFor(file: string): "ts" | "tsx" | "js" | "jsx" {
	const e = extname(file);
	if (e === ".tsx") return "tsx";
	if (e === ".ts" || e === ".mts" || e === ".cts") return "ts";
	if (e === ".jsx") return "jsx";
	return "js";
}

/**
 * Rewrite relative import/export specifiers to stable /@apply-react/mod/ URLs.
 */
export function rewriteRelativeImportsToModUrls(
	source: string,
	fromFile: string,
	moduleRootAbs: string,
): string {
	return source.replace(
		/(from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g,
		(full, prefix: string, spec: string) => {
			const resolved = resolveSpecifier(fromFile, spec, moduleRootAbs);
			if (!resolved) return full;
			const url = toModUrl(moduleRootAbs, resolved);
			const quote = full.includes("'") ? "'" : '"';
			return `${prefix}${quote}${url}${quote}`;
		},
	);
}

/**
 * Transpile a single app file to ESM with stable external mod URLs for locals.
 */
export async function transpileModFile(
	absoluteFile: string,
	moduleRootAbs: string,
): Promise<{ code: string; contentType: string } | { error: string }> {
	if (!existsSync(absoluteFile)) {
		return { error: `File not found: ${absoluteFile}` };
	}

	try {
		const source = readFileSync(absoluteFile, "utf8");
		const rewritten = rewriteRelativeImportsToModUrls(
			source,
			absoluteFile,
			moduleRootAbs,
		);
		const loader = loaderFor(absoluteFile);
		const transpiler = new Bun.Transpiler({
			loader,
			tsconfig: {
				compilerOptions: {
					jsx: "react-jsx",
					jsxImportSource: "react",
				},
			},
		});
		let code = transpiler.transformSync(rewritten);

		// Ensure jsx runtime import if transform injected jsx calls without import
		if (
			/\bjsxDEV\b|\bjsx\b|\bjsxs\b/.test(code) &&
			!/from\s+["']react\/jsx-/.test(code)
		) {
			code = `import { jsx as _jsx, jsxs as _jsxs, jsxDEV as _jsxDEV, Fragment as _Fragment } from "react/jsx-dev-runtime";\n${code}`;
			// Bun may emit jsxDEV_xxx identifiers — map common patterns
			code = code
				.replace(/\bjsxDEV_\w+/g, "_jsxDEV")
				.replace(/\bjsx_\w+/g, "_jsx")
				.replace(/\bjsxs_\w+/g, "_jsxs");
		}

		return { code, contentType: "application/javascript; charset=utf-8" };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}

export async function handleModRequest(
	req: Request,
	moduleRootAbs: string,
): Promise<Response> {
	const url = new URL(req.url);
	const file = resolveModFile(moduleRootAbs, url.pathname);
	if (!file) {
		return new Response(`Not found: ${url.pathname}`, { status: 404 });
	}

	const out = await transpileModFile(file, moduleRootAbs);
	if ("error" in out) {
		return new Response(out.error, {
			status: 500,
			headers: { "content-type": "text/plain; charset=utf-8" },
		});
	}

	return new Response(out.code, {
		status: 200,
		headers: {
			"content-type": out.contentType,
			"cache-control": url.searchParams.has("t") ? "no-store" : "no-cache",
		},
	});
}
