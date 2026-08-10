import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

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

export function resolveWatchDirectories(
	projectRoot: string,
	watchDirectories?: string[],
	watchDirectoriesExclude?: string[],
): string[] {
	const include = watchDirectories ?? ["."];
	const resolved = include.map((dir) => resolve(projectRoot, dir));
	if (!watchDirectoriesExclude?.length) return resolved;

	const excludes = watchDirectoriesExclude.map((dir) =>
		resolve(projectRoot, dir),
	);
	return resolved.filter(
		(dir) => !excludes.some((ex) => dir === ex || dir.startsWith(ex + "/")),
	);
}
