import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Resolve the app module root (customizable; not fixed to "src").
 *
 * 1. Explicit `moduleRoot` if set
 * 2. Parent of `route` when route ends with `/pages` or `/page`
 * 3. `"src"` if that directory exists
 * 4. Otherwise parent of `route`
 */
export function resolveModuleRoot(
	cwd: string,
	route: string,
	moduleRoot?: string,
): { absolute: string; relative: string } {
	if (moduleRoot != null && moduleRoot !== "") {
		const relative = moduleRoot.replace(/^\.\//, "").replace(/\/$/, "") || ".";
		return { absolute: resolve(cwd, relative), relative };
	}

	const routeNorm = route.replace(/\\/g, "/").replace(/\/$/, "");
	const base = basename(routeNorm);
	if (base === "pages" || base === "page") {
		const parent = dirname(routeNorm);
		const relative = parent === "." ? "." : parent;
		return { absolute: resolve(cwd, relative), relative };
	}

	const srcAbs = join(cwd, "src");
	if (existsSync(srcAbs)) {
		return { absolute: srcAbs, relative: "src" };
	}

	const parent = dirname(routeNorm);
	const relative = parent === "." ? "." : parent;
	return { absolute: resolve(cwd, relative), relative };
}
