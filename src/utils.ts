import { getRelatedLayoutFromPathname } from "./layout";

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
export async function preLoadPath(pathname: string) {
	if (typeof window === "undefined") return Promise.resolve();

	if (pathnameCached.has(pathname)) return Promise.resolve();
	pathnameCached.add(pathname);

	const { router } = await import("./router");
	const _ROUTES_ = (await import("@apply-react/client-routes.ts")).default;

	const matched = router.match(pathname);

	if (!matched) throw new Error(`No route matched for pathname: ${pathname}`);

	return Promise.all([
		_ROUTES_[matched.pathname]?.(),
		getRelatedLayoutFromPathname(matched.pathname, _ROUTES_),
	]);
}

export class NotFoundError extends Error {
	constructor() {
		super("Not Found");
		this.name = "NotFoundError";
	}
}
/**
 * Throw a NotFoundError to trigger the rendering of the NotFound component. This is useful inside route components to indicate that the requested resource was not found, allowing for a consistent handling of 404 errors across the application.
 *
 * this will be caught by the RouterHost component and will trigger the rendering of the NotFound component, which can be customized by the user to display a user-friendly message or UI for not found pages.
 *
 * The NotFound Component at the same level will be displayed when the error is thrown, allowing you to show a custom 404 page or message to the user.
 * @example
 * // e.g src/pages/users/404.tsx
 * export default function UsersNotFound() {
 *   return <div>User Not Found</div>;
 * }
 *
 * // e.g src/pages/users/[userId].tsx
 * import { ThrowNotFound } from "@apply-react/utils";
 *
 * export default function UserProfile({ userId }: { userId: string }) {
 *   const user = useUser(userId);
 *
 *   if (!user) {
 *     ThrowNotFound();
 *   }
 *
 *   return <div>{user.name}'s Profile</div>;
 * }
 *
 * @example
 *
 */
export function ThrowNotFound() {
	throw new NotFoundError();
}
