import {
	basename,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

export type WatchClassifyKind =
	| "page"
	| "layout"
	| "loading"
	| "not-found"
	| "runtime"
	| "shared"
	| "ignored";

export type WatchClassifyResult = {
	kind: WatchClassifyKind;
	/** Relative path under route dir when applicable */
	routeRelativePath: string | null;
	/** Pathname-like key for page routes (e.g. /sub/[id]) */
	pagePathname: string | null;
};

/** Paths that must never trigger HMR (build output / VCS / deps). */
const IGNORED_PATH_PREFIXES = [
	".frame-master/",
	"node_modules/",
	".git/",
	"dist/",
	"build/",
	"coverage/",
	".next/",
	"out/",
];

/**
 * True for FS-router special segment names (not real navigable pages).
 */
export function isSpecialRouteName(routeName: string): boolean {
	const base = routeName.split("/").filter(Boolean).pop() ?? "";
	return (
		base === "layout" ||
		base === "loading" ||
		base === "404" ||
		base === "error" ||
		base === "template" ||
		base === "not-found"
	);
}

/**
 * Ignore build artifacts and package dirs so HMR rebuilds cannot re-trigger themselves.
 */
export function shouldIgnoreWatchPath(
	projectRoot: string,
	changedPath: string,
): boolean {
	const normalized = resolve(projectRoot, changedPath);
	const rel = relative(projectRoot, normalized).replace(/\\/g, "/");
	if (!rel || rel === "..") return true;
	if (rel.startsWith("../") || isAbsolute(rel)) {
		// Outside project — ignore (avoid watching unrelated system files)
		return true;
	}
	return IGNORED_PATH_PREFIXES.some(
		(prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix),
	);
}

const SPECIAL_BASENAMES = new Set([
	"layout",
	"loading",
	"404",
	"error",
	"template",
]);

const RUNTIME_BASENAME_HINTS = [
	"client-shell",
	"hydrate",
	"HMR",
	"client-hydrate",
];

/**
 * Map a changed file under the pages directory to a URL pathname for page routes.
 * Returns null for special files (layout/loading/404) or paths outside routeDir.
 */
export function getRoutePathnameFromFileChange(
	projectRoot: string,
	routeDir: string,
	changedPath: string,
): string | null {
	const classified = classifyWatchPath(projectRoot, routeDir, changedPath);
	if (classified.kind !== "page") return null;
	return classified.pagePathname;
}

export function classifyWatchPath(
	projectRoot: string,
	routeDir: string,
	changedPath: string,
	runtimePaths: string[] = [],
): WatchClassifyResult {
	const normalizedPath = resolve(projectRoot, changedPath);

	if (shouldIgnoreWatchPath(projectRoot, normalizedPath)) {
		return {
			kind: "ignored",
			routeRelativePath: null,
			pagePathname: null,
		};
	}

	const resolvedRuntime = runtimePaths.map((p) => resolve(projectRoot, p));

	if (resolvedRuntime.some((p) => p === normalizedPath)) {
		return {
			kind: "runtime",
			routeRelativePath: null,
			pagePathname: null,
		};
	}

	const base = basename(normalizedPath, extname(normalizedPath));
	if (RUNTIME_BASENAME_HINTS.includes(base)) {
		// Only treat as runtime if outside or at project rootish paths
		const relToRoot = relative(projectRoot, normalizedPath);
		if (!relToRoot.startsWith("src/pages") && !relToRoot.includes(`${join("pages")}`)) {
			// fall through — pages never named hydrate typically
		}
	}

	const relativePath = relative(routeDir, normalizedPath);
	if (
		!relativePath ||
		relativePath.startsWith("..") ||
		isAbsolute(relativePath)
	) {
		// Outside route dir — shared project file
		return {
			kind: "shared",
			routeRelativePath: null,
			pagePathname: null,
		};
	}

	const ext = extname(relativePath);
	if (![".tsx", ".jsx", ".ts", ".js"].includes(ext)) {
		return {
			kind: "ignored",
			routeRelativePath: relativePath,
			pagePathname: null,
		};
	}

	const name = basename(relativePath, ext);
	if (name === "layout") {
		return {
			kind: "layout",
			routeRelativePath: relativePath,
			pagePathname: null,
		};
	}
	if (name === "loading") {
		return {
			kind: "loading",
			routeRelativePath: relativePath,
			pagePathname: null,
		};
	}
	if (name === "404" || name === "not-found") {
		return {
			kind: "not-found",
			routeRelativePath: relativePath,
			pagePathname: null,
		};
	}
	if (SPECIAL_BASENAMES.has(name) && name !== "template") {
		return {
			kind: "ignored",
			routeRelativePath: relativePath,
			pagePathname: null,
		};
	}

	return {
		kind: "page",
		routeRelativePath: relativePath,
		pagePathname: filePathToPathname(relativePath),
	};
}

export function filePathToPathname(fp: string) {
	let fpNoExt = fp.replace(/\.(tsx|jsx|ts|js)$/, "");
	if (fpNoExt.endsWith("index")) {
		fpNoExt = fpNoExt.slice(0, -"index".length);
		if (fpNoExt.endsWith("/")) fpNoExt = fpNoExt.slice(0, -1);
		fpNoExt = fpNoExt || "/";
	}
	// strip trailing slash except root
	if (fpNoExt.length > 1 && fpNoExt.endsWith("/")) {
		fpNoExt = fpNoExt.slice(0, -1);
	}
	return fpNoExt.startsWith("/") ? fpNoExt : `/${fpNoExt}`;
}

const DEFAULT_WATCH_EXCLUDES = [
	".frame-master",
	"node_modules",
	".git",
	"dist",
	"build",
	"coverage",
];

export function resolveWatchDirectories(
	projectRoot: string,
	watchDirectories?: string[],
	watchDirectoriesExclude?: string[],
): string[] {
	const include = watchDirectories ?? ["."];
	const resolved = include.map((dir) => resolve(projectRoot, dir));
	const excludes = [
		...DEFAULT_WATCH_EXCLUDES,
		...(watchDirectoriesExclude ?? []),
	].map((dir) => resolve(projectRoot, dir));

	// Prefer watching the route tree when default "." would include build output.
	// Callers still pass explicit watchDirectories when they want broader scope;
	// ignored paths are also filtered in onFileSystemChange.
	return resolved.filter(
		(dir) => !excludes.some((ex) => dir === ex || dir.startsWith(`${ex}/`)),
	);
}
