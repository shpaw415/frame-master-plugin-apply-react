import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import {
	type ModuleRootEntry,
	compileEntrypointExclude,
	findContainingRoot,
	matchesEntrypointExclude,
	toModPublicRel,
} from "./module-root";

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

export type ListModuleFilesOptions = {
	/** Project cwd for exclude matching / relative paths */
	cwd?: string;
	/** Regex patterns (or string sources) — matching files are not entrypoints */
	entrypointExclude?: Array<string | RegExp>;
};

function asRoots(
	moduleRoots: string | string[] | ModuleRootEntry[],
): ModuleRootEntry[] {
	if (typeof moduleRoots === "string") {
		const absolute = resolve(moduleRoots);
		return [{ absolute, relative: "." }];
	}
	if (moduleRoots.length === 0) return [];
	if (typeof moduleRoots[0] === "string") {
		return (moduleRoots as string[]).map((r) => {
			const absolute = resolve(r);
			return { absolute, relative: "." };
		});
	}
	return (moduleRoots as ModuleRootEntry[]).map((r) => ({
		absolute: resolve(r.absolute),
		relative: r.relative,
	}));
}

export function listModuleFiles(
	moduleRoots: string | string[] | ModuleRootEntry[],
	mode: "all" | "reachable",
	seeds: string[] = [],
	options: ListModuleFilesOptions = {},
): string[] {
	const roots = asRoots(moduleRoots);
	if (roots.length === 0) return [];
	const cwd = options.cwd ?? process.cwd();
	const exclude = compileEntrypointExclude(options.entrypointExclude);

	const accept = (abs: string) => {
		if (!isAppSourceFile(abs)) return false;
		if (!findContainingRoot(roots, abs)) return false;
		if (matchesEntrypointExclude(abs, roots, cwd, exclude)) return false;
		return true;
	};

	if (mode === "all") {
		const out: string[] = [];
		const seen = new Set<string>();
		for (const root of roots) {
			for (const f of walkDir(root.absolute)) {
				const norm = resolve(f);
				if (seen.has(norm)) continue;
				if (!accept(norm)) continue;
				seen.add(norm);
				out.push(norm);
			}
		}
		return out;
	}

	const rootAbsList = roots.map((r) => r.absolute);
	const syncQueue = seeds.map((s) => resolve(s)).filter(existsSync);
	const collected = new Set<string>();
	while (syncQueue.length) {
		const current = syncQueue.pop()!;
		const norm = resolve(current);
		if (collected.has(norm)) continue;
		if (!findContainingRoot(roots, norm)) continue;
		if (!existsSync(norm)) continue;
		if (!isAppSourceFile(norm)) continue;
		// reachable mode still discovers excluded files as graph deps, but they
		// are filtered from the returned entrypoint list below.
		collected.add(norm);
		const text = readFileSyncSafe(norm);
		if (!text) continue;
		for (const spec of extractRelativeSpecifiers(text)) {
			const resolved = resolveSpecifier(norm, spec, rootAbsList);
			if (resolved) syncQueue.push(resolved);
		}
	}

	let files =
		collected.size === 0
			? roots.flatMap((r) => walkDir(r.absolute))
			: [...collected];

	files = files.map((f) => resolve(f)).filter(accept);
	// dedupe
	return [...new Set(files)];
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
	moduleRootAbsList: string[],
): string | null {
	const base = resolve(dirname(fromFile), spec);
	const candidates = [
		base,
		...RESOLVE_EXTENSIONS.map((e) => base + e),
		...RESOLVE_EXTENSIONS.map((e) => join(base, `index${e}`)),
	];
	for (const c of candidates) {
		if (!existsSync(c)) continue;
		const resolved = resolve(c);
		if (
			moduleRootAbsList.some(
				(root) => resolved === root || resolved.startsWith(root + "/"),
			)
		) {
			return resolved;
		}
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
 * Stable browser URL for a module under module root(s).
 * Always `.js` extension; path segments are encoded (`[id].js`).
 *
 * @param moduleRoots single abs path string, or ModuleRootEntry[]
 */
export function toModUrl(
	moduleRoots: string | ModuleRootEntry[],
	absoluteFile: string,
): string {
	const roots = asRoots(moduleRoots);
	const pub = toModPublicRel(roots, absoluteFile);
	if (!pub) {
		throw new Error(
			`[Apply-React] file outside moduleRoot: ${absoluteFile}`,
		);
	}
	return `/@apply-react/mod/${encodeModRelPath(pub)}`;
}

/**
 * Virtual Bun entrypoint key for a source file under module root(s).
 * Build emits path-stable `@apply-react/mod/<rel>.js` from this key.
 */
export function toVirtualModEntry(
	moduleRoots: string | ModuleRootEntry[],
	absoluteFile: string,
): string {
	const roots = asRoots(moduleRoots);
	const pub = toModPublicRel(roots, absoluteFile);
	if (!pub) {
		throw new Error(
			`[Apply-React] file outside moduleRoot: ${absoluteFile}`,
		);
	}
	return `@apply-react/mod/${pub}`;
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

/**
 * Decode `/@apply-react/mod/...` pathname to an absolute path under some module root
 * (may end in `.js`).
 */
export function fromModUrlPath(
	moduleRoots: string | ModuleRootEntry[],
	urlPathname: string,
): string | null {
	const roots = asRoots(moduleRoots);
	const prefix = "/@apply-react/mod/";
	if (!urlPathname.startsWith(prefix)) return null;
	const rel = decodeModRelSegments(urlPathname.slice(prefix.length));
	if (!rel || rel.includes("..")) return null;

	// Prefer multi-root: strip matching root.relative prefix first
	if (roots.length > 1) {
		const sorted = [...roots].sort(
			(a, b) => b.relative.length - a.relative.length,
		);
		for (const root of sorted) {
			const r = root.relative.replace(/\\/g, "/");
			if (r && r !== "." && (rel === r || rel.startsWith(r + "/"))) {
				const rest = rel === r ? "" : rel.slice(r.length + 1);
				const abs = resolve(root.absolute, rest);
				if (abs === root.absolute || abs.startsWith(root.absolute + "/")) {
					return abs;
				}
			}
		}
	}

	// Single-root style (or multi fallback): try each root with full rel
	for (const root of roots) {
		const abs = resolve(root.absolute, rel);
		if (abs === root.absolute || abs.startsWith(root.absolute + "/")) {
			return abs;
		}
	}
	return null;
}

/**
 * Map a public mod URL (…/index.js) back to the on-disk source file (…/index.tsx).
 */
export function resolveModFile(
	moduleRoots: string | ModuleRootEntry[],
	urlPathname: string,
): string | null {
	const abs = fromModUrlPath(moduleRoots, urlPathname);
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
	moduleRoots: string | ModuleRootEntry[],
): string {
	const roots = asRoots(moduleRoots);
	const rootAbsList = roots.map((r) => r.absolute);
	return source.replace(
		/(from\s+|import\s*\(\s*)["'](\.[^"']+)["']/g,
		(full, prefix: string, spec: string) => {
			const resolved = resolveSpecifier(fromFile, spec, rootAbsList);
			if (!resolved) return full;
			const url = toModUrl(roots, resolved);
			const quote = full.includes("'") ? "'" : '"';
			return `${prefix}${quote}${url}${quote}`;
		},
	);
}

export type HandleBuiltModOptions = {
	moduleRoots: ModuleRootEntry[] | string;
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

	const roots = asRoots(options.moduleRoots);
	const source = resolveModFile(roots, url.pathname);
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

/** @deprecated Use handleBuiltModRequest */
export async function handleModRequest(
	req: Request,
	moduleRootAbs: string | ModuleRootEntry[],
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
		moduleRoots: moduleRootAbs,
		getBuildOutDir,
		onMissingArtifact,
	});
}
