import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

export type ModuleRootEntry = {
	/** Absolute filesystem path */
	absolute: string;
	/** Project-relative path (posix-ish), used for multi-root public URL prefixes */
	relative: string;
};

function normalizeRel(input: string): string {
	return input.replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, "") || ".";
}

/**
 * Resolve one or more app module roots (customizable; not fixed to "src").
 *
 * `moduleRoot` may be a string or an array of paths.
 *
 * When omitted:
 * 1. Parent of `route` when route ends with `/pages` or `/page`
 * 2. `"src"` if that directory exists
 * 3. Otherwise parent of `route`
 */
export function resolveModuleRoots(
	cwd: string,
	route: string,
	moduleRoot?: string | string[],
): ModuleRootEntry[] {
	if (moduleRoot != null) {
		const list = (Array.isArray(moduleRoot) ? moduleRoot : [moduleRoot])
			.map((r) => (typeof r === "string" ? r.trim() : ""))
			.filter((r) => r !== "");
		if (list.length > 0) {
			const seen = new Set<string>();
			const out: ModuleRootEntry[] = [];
			for (const raw of list) {
				const rel = normalizeRel(raw);
				const absolute = resolve(cwd, rel);
				if (seen.has(absolute)) continue;
				seen.add(absolute);
				out.push({ absolute, relative: rel });
			}
			if (out.length > 0) return out;
		}
	}

	const routeNorm = route.replace(/\\/g, "/").replace(/\/$/, "");
	const base = basename(routeNorm);
	if (base === "pages" || base === "page") {
		const parent = dirname(routeNorm);
		const relativePath = parent === "." ? "." : parent;
		return [{ absolute: resolve(cwd, relativePath), relative: relativePath }];
	}

	const srcAbs = join(cwd, "src");
	if (existsSync(srcAbs)) {
		return [{ absolute: srcAbs, relative: "src" }];
	}

	const parent = dirname(routeNorm);
	const relativePath = parent === "." ? "." : parent;
	return [{ absolute: resolve(cwd, relativePath), relative: relativePath }];
}

/**
 * @deprecated Prefer {@link resolveModuleRoots}. Returns the first resolved root.
 */
export function resolveModuleRoot(
	cwd: string,
	route: string,
	moduleRoot?: string | string[],
): ModuleRootEntry {
	return resolveModuleRoots(cwd, route, moduleRoot)[0]!;
}

/** Longest-prefix module root that contains `absoluteFile`, or null. */
export function findContainingRoot(
	roots: ModuleRootEntry[],
	absoluteFile: string,
): ModuleRootEntry | null {
	const file = resolve(absoluteFile);
	let best: ModuleRootEntry | null = null;
	for (const root of roots) {
		const abs = resolve(root.absolute);
		if (file === abs || file.startsWith(abs + "/")) {
			if (!best || abs.length > resolve(best.absolute).length) {
				best = { absolute: abs, relative: root.relative };
			}
		}
	}
	return best;
}

export function isUnderModuleRoots(
	roots: ModuleRootEntry[],
	absoluteFile: string,
): boolean {
	return findContainingRoot(roots, absoluteFile) != null;
}

/**
 * Public path relative to the mod URL space (no leading slash, may keep source ext).
 * Single root: relative to that root (BC).
 * Multiple roots: `<root.relative>/<rel>` so paths stay unique.
 */
export function toModPublicRel(
	roots: ModuleRootEntry[],
	absoluteFile: string,
): string | null {
	const root = findContainingRoot(roots, absoluteFile);
	if (!root) return null;
	const rel = relative(root.absolute, resolve(absoluteFile)).replace(
		/\\/g,
		"/",
	);
	if (!rel || rel.startsWith("..")) return null;
	if (roots.length === 1) return rel;
	if (root.relative === "." || root.relative === "") return rel;
	return `${root.relative.replace(/\\/g, "/")}/${rel}`.replace(/\/+/g, "/");
}

/**
 * Compile `entrypointExclude` patterns (string sources or RegExp).
 */
export function compileEntrypointExclude(
	patterns?: Array<string | RegExp> | null,
): RegExp[] {
	if (!patterns?.length) return [];
	const out: RegExp[] = [];
	for (const p of patterns) {
		if (p instanceof RegExp) {
			out.push(p);
			continue;
		}
		if (typeof p === "string" && p !== "") {
			try {
				out.push(new RegExp(p));
			} catch {
				// invalid regex — treat as escaped literal
				out.push(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
			}
		}
	}
	return out;
}

/**
 * True when the file matches any exclude pattern.
 * Tested against: absolute path, cwd-relative path, and mod public rel.
 */
export function matchesEntrypointExclude(
	absoluteFile: string,
	roots: ModuleRootEntry[],
	cwd: string,
	exclude: RegExp[],
): boolean {
	if (!exclude.length) return false;
	const abs = resolve(absoluteFile).replace(/\\/g, "/");
	const cwdRel = relative(cwd, abs).replace(/\\/g, "/");
	const pub = toModPublicRel(roots, abs) ?? "";
	const candidates = [abs, cwdRel, pub].filter(Boolean);
	return exclude.some((re) => candidates.some((c) => re.test(c)));
}
