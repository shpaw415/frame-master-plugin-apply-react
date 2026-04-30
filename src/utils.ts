import { getRelatedLayoutFromPathname } from "./layout";
import _ROUTES_ from "@apply-react/client-routes.ts";
import FileSystemRouter from "bun-file-system-router-browser";

export const router = new FileSystemRouter({
	routes: Object.keys(_ROUTES_),
	style: "nextjs",
});

/**
 * Navigate to a new pathname keeping the SPA behavior (without full page reload).
 */
export function navigate(pathname: string) {
	const a = document.createElement("a");
	a.href = pathname;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

const pathnameCached = new Set<string>();

/**
 * Import a route and it's layouts in cache for a given pathname. This is useful to pre-load a page before navigating to it, improving the perceived performance of the application.
 */
export function preLoadPath(pathname: string) {
	if (pathnameCached.has(pathname)) return Promise.resolve();
	pathnameCached.add(pathname);

	const matched = router.match(pathname);

	if (!matched) throw new Error(`No route matched for pathname: ${pathname}`);

	return Promise.all([
		_ROUTES_[matched.pathname]?.(),
		getRelatedLayoutFromPathname(matched.pathname, _ROUTES_),
	]);
}
