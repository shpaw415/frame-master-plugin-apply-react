import _ROUTES_ from "@apply-react/client-routes.ts";
import { type JSX, useCallback, useEffect, useState } from "react";
import { setupHMR } from "./HMR";
import { getRelatedLayoutFromPathname, WrapWithLayouts } from "./layout";
import { formatPathname } from "./utils";
import HMR_ENABLED from "@apply-react/HMR-enabled.ts";

/**
 * Client-side router component for the Apply-React plugin.
 *
 * @features
 * - Intercepts anchor tag clicks for seamless client-side navigation
 * - Handles browser back/forward navigation via popstate events
 * - Automatically integrates with HMR in development mode
 * - Maintains route state synchronized with browser history
 * - Only processes internal links while preserving external link behavior
 *
 * @param children - The initial page component to render
 * @returns The current page component based on the active route
 */
export function RouterHost({ children }: { children: JSX.Element }) {
	const [CurrentPage, setCurrentPage] = useState<() => JSX.Element>(
		() => children,
	);
	const [routes, setRoutes] = useState(
		typeof window === "undefined" ? {} : _ROUTES_,
	);

	const createPage = useCallback(
		async (_pathname: string, routes: typeof _ROUTES_) => {
			const pathname = formatPathname(_pathname);
			const layouts = getRelatedLayoutFromPathname(pathname, routes);
			const Page = await routes[pathname]?.();

			if (!Page) return () => <div>404 - Page Not Found</div>;

			return () => (
				<WrapWithLayouts layouts={layouts}>
					<Page />
				</WrapWithLayouts>
			);
		},
		[],
	);

	useEffect(
		() =>
			HMR_ENABLED
				? setupHMR((newRoutes) => {
						setRoutes((curr) => {
							createPage(window.location.pathname, {
								...curr,
								[newRoutes.pathname]: newRoutes.component,
							}).then(setCurrentPage);
							return { ...curr, [newRoutes.pathname]: newRoutes.component };
						});
					})
				: undefined,
		[createPage],
	);

	useEffect(() => {
		const popStateHandler = async () => {
			setCurrentPage(await createPage(window.location.pathname, routes));
		};

		const clickHandler = async (e: MouseEvent) => {
			if (e.ctrlKey) return;

			const target = e.target as HTMLElement;
			const anchor = target.closest("a");

			if (anchor?.href) {
				const url = new URL(anchor.href);
				url.pathname = formatPathname(url.pathname);

				// Only handle internal links (same origin)
				if (url.origin === window.location.origin) {
					// Handle hash-only links (anchors on the same page)
					if (
						url.pathname === window.location.pathname &&
						url.search === window.location.search &&
						url.hash
					) {
						// Let the browser handle scrolling to the anchor
						return;
					}

					e.preventDefault();

					// Check if route exists
					if (routes[url.pathname]) {
						// Update browser history with full URL including hash
						window.history.pushState(
							null,
							"",
							url.pathname + url.search + url.hash,
						);
						// Update current page
						setCurrentPage(await createPage(window.location.pathname, routes));

						// Handle hash scrolling after navigation
						if (url.hash) {
							// Use requestAnimationFrame to ensure the element is rendered
							requestAnimationFrame(() => {
								const element = document.getElementById(url.hash.slice(1));
								if (element) {
									element.scrollIntoView({ behavior: "smooth" });
								}
							});
						} else {
							// Scroll to top if no hash
							window.scrollTo(0, 0);
						}
					}
				}
			}
		};

		window.addEventListener("popstate", popStateHandler);
		document.addEventListener("click", clickHandler);

		return () => {
			window.removeEventListener("popstate", popStateHandler);
			document.removeEventListener("click", clickHandler);
		};
	}, [routes, createPage]);

	return CurrentPage as unknown as JSX.Element;
}
