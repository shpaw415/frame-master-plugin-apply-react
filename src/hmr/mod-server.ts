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

const SOURCE_EXT_RE = /\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/i;

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

/** Public module URLs always use `.js` (built), never source `.tsx`. */
export function toPublicModRelPath(rel: string): string {
	const normalized = rel.replace(/\\/g, "/");
	const asJs = normalized.replace(SOURCE_EXT_RE, ".js");
	return asJs.endsWith(".js") ? asJs : `${asJs}.js`;
}

/** Encode moduleRoot-relative path for use in `/@apply-react/mod/...` URLs. */
export function encodeModRelPath(rel: string): string {
	return toPublicModRelPath(rel)
		.split("/")
		.filter(Boolean)
		.map((seg) => encodeURIComponent(seg))
		.join("/");
}

/**
 * Stable browser URL for a module under moduleRoot.
 * Always `.js` extension; path segments are encoded (`[id].js`).
 */
export function toModUrl(moduleRootAbs: string, absoluteFile: string): string {
	const rel = relative(moduleRootAbs, absoluteFile).replace(/\\/g, "/");
	return `/@apply-react/mod/${encodeModRelPath(rel)}`;
}

/**
 * Virtual Bun entrypoint key for a source file under moduleRoot.
 * Build emits path-stable `@apply-react/mod/<rel>.js` from this key.
 */
export function toVirtualModEntry(
	moduleRootAbs: string,
	absoluteFile: string,
): string {
	const rel = relative(moduleRootAbs, absoluteFile).replace(/\\/g, "/");
	if (!rel || rel.startsWith("..")) {
		throw new Error(
			`[Apply-React] file outside moduleRoot: ${absoluteFile} (root=${moduleRootAbs})`,
		);
	}
	return `@apply-react/mod/${rel}`;
}

/** Decode a virtual entry key or public mod URL path to moduleRoot-relative form. */
export function decodeModRelSegments(encodedRel: string): string {
	return encodedRel
		.split("/")
		.map((seg) => {
			try {
				return decodeURIComponent(seg);
			} catch {
				return seg;
			}
		})
		.join("/");
}

/** Decode `/@apply-react/mod/...` pathname to an absolute path under moduleRoot (may end in `.js`). */
export function fromModUrlPath(
	moduleRootAbs: string,
	urlPathname: string,
): string | null {
	const prefix = "/@apply-react/mod/";
	if (!urlPathname.startsWith(prefix)) return null;
	const rel = decodeModRelSegments(urlPathname.slice(prefix.length));
	if (!rel || rel.includes("..")) return null;
	const abs = resolve(moduleRootAbs, rel);
	if (!abs.startsWith(moduleRootAbs)) return null;
	return abs;
}

/**
 * Map a public mod URL (…/index.js) back to the on-disk source file (…/index.tsx).
 */
export function resolveModFile(
	moduleRootAbs: string,
	urlPathname: string,
): string | null {
	const abs = fromModUrlPath(moduleRootAbs, urlPathname);
	if (!abs) return null;

	if (existsSync(abs) && isAppSourceFile(abs)) return abs;

	const withoutJs = abs.replace(/\.js$/i, "");
	const candidates = [
		withoutJs,
		...RESOLVE_EXTENSIONS.map((e) => withoutJs + e),
		...RESOLVE_EXTENSIONS.map((e) => join(withoutJs, `index${e}`)),
		abs,
		...RESOLVE_EXTENSIONS.map((e) => abs + e),
	];
	for (const c of candidates) {
		if (existsSync(c) && (isAppSourceFile(c) || extname(c) === ".json")) {
			return c;
		}
	}
	return null;
}

/**
 * Absolute path of the built artifact for a public `/@apply-react/mod/...` URL.
 * Decodes `%5B` so disk can keep `[id].js` while the URL is encoded.
 */
export function resolveBuiltModPath(
	buildOutDir: string,
	urlPathname: string,
): string | null {
	const prefix = "/@apply-react/mod/";
	if (!urlPathname.startsWith(prefix)) return null;
	const rel = decodeModRelSegments(urlPathname.slice(prefix.length));
	if (!rel || rel.includes("..")) return null;
	const outAbs = resolve(buildOutDir);
	const built = resolve(outAbs, "@apply-react", "mod", rel);
	if (!built.startsWith(join(outAbs, "@apply-react", "mod"))) return null;
	return built;
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

export type HandleBuiltModOptions = {
	moduleRootAbs: string;
	/** Absolute or cwd-relative build outdir */
	getBuildOutDir: () => string;
	/** Kick a rebuild when the artifact is missing (debounced by caller). */
	onMissingArtifact?: (urlPathname: string) => void;
};

/**
 * Serve a built per-file module from the Frame-Master outdir.
 * Never live-transpiles — missing artifacts 404 and optionally trigger rebuild.
 */
export async function handleBuiltModRequest(
	req: Request,
	options: HandleBuiltModOptions,
): Promise<Response> {
	const url = new URL(req.url);
	const outDir = options.getBuildOutDir();
	const built = resolveBuiltModPath(outDir, url.pathname);

	if (!built) {
		return new Response(`Invalid mod path: ${url.pathname}`, { status: 400 });
	}

	if (existsSync(built)) {
		const file = Bun.file(built);
		return new Response(file, {
			status: 200,
			headers: {
				"content-type": "application/javascript; charset=utf-8",
				"cache-control": url.searchParams.has("t") ? "no-store" : "no-cache",
			},
		});
	}

	// Also try source resolve for clearer error (and rebuild kick)
	const source = resolveModFile(options.moduleRootAbs, url.pathname);
	options.onMissingArtifact?.(url.pathname);

	const hint = source
		? `source exists at ${source}; not in last build`
		: "no matching source under moduleRoot";

	return new Response(
		`module not in last build: ${url.pathname} (${hint})`,
		{
			status: 404,
			headers: { "content-type": "text/plain; charset=utf-8" },
		},
	);
}

/** @deprecated Use handleBuiltModRequest — kept for external re-exports during transition */
export async function handleModRequest(
	req: Request,
	moduleRootAbs: string,
	getBuildOutDir?: () => string,
	onMissingArtifact?: (urlPathname: string) => void,
): Promise<Response> {
	if (!getBuildOutDir) {
		return new Response(
			"per-file modules require a build outdir (handleBuiltModRequest)",
			{ status: 500 },
		);
	}
	return handleBuiltModRequest(req, {
		moduleRootAbs,
		getBuildOutDir,
		onMissingArtifact,
	});
}
