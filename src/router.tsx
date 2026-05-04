import _ROUTES_ from "@apply-react/client-routes.ts";
import { Component, type JSX, useCallback, useEffect, useState } from "react";
import { setupHMR } from "./HMR";
import { getRelatedLayoutFromPathname, WrapWithLayouts } from "./layout";
import { router, NotFoundError } from "./utils";
import FallbackDefault404 from "@apply-react/404.tsx";
import FallbackDefaultLoading from "@apply-react/loading.tsx";
import HMR_ENABLED from "@apply-react/HMR-enabled.ts";
import type { MatchedRoute } from "bun-file-system-router-browser";

/**
 * Resolver function for mapping a thrown error to a fallback page component.
 * Return the fallback component, or `null` to let the next resolver handle it.
 */
export type ErrorFallbackResolver = (
	error: Error,
	pathname: string,
	Layouts: (props: { children: JSX.Element }) => JSX.Element | null,
) => Promise<(() => JSX.Element) | null>;

export const defaultErrorResolvers: ErrorFallbackResolver[] = [
	async (error, pathname, Layouts) => {
		if (error instanceof NotFoundError) {
			const NotFoundPage = await getNotFoundComponent(pathname);
			return () => (
				<Layouts>
					<NotFoundPage />
				</Layouts>
			);
		}
		return null;
	},
];

interface ErrorWrapperProps {
	children: JSX.Element;
	resolvers: ErrorFallbackResolver[];
}

interface ErrorWrapperState {
	error: Error | null;
	FallbackComponent: (() => JSX.Element) | null;
}

/**
 * Error boundary that catches errors thrown inside a page component and
 * resolves them to fallback pages via the provided `resolvers` chain.
 * Reset by changing the `key` prop (e.g. on every navigation).
 */
export class ErrorWrapper extends Component<
	ErrorWrapperProps,
	ErrorWrapperState
> {
	override state: ErrorWrapperState = { error: null, FallbackComponent: null };

	static getDerivedStateFromError(error: Error): Partial<ErrorWrapperState> {
		return { error };
	}

	override async componentDidCatch(error: Error) {
		const pathname = globalThis?.location?.pathname ?? "/";
		for (const resolver of this.props.resolvers) {
			const layouts = await getRelatedLayoutFromPathname(pathname, _ROUTES_);
			const fallback = await resolver(
				error,
				pathname,
				({ children }: { children: JSX.Element }) => (
					<WrapWithLayouts layouts={layouts}>{children}</WrapWithLayouts>
				),
			);
			if (fallback) {
				this.setState({ FallbackComponent: fallback });
				return;
			}
		}
	}

	override render() {
		if (this.state.error) {
			if (this.state.FallbackComponent) {
				const Fallback = this.state.FallbackComponent;
				return <Fallback />;
			}
			return null;
		}
		return this.props.children;
	}
}

export type RouterHostProps = {
	children: JSX.Element;
	/** Override or extend the error-to-fallback-page resolver chain. */
	errorResolvers?: ErrorFallbackResolver[];
	/** Callback invoked on every route change. */
	onRouteChange?: (route: MatchedRoute) => void | Promise<void>;
};

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
export function RouterHost({
	children,
	errorResolvers = defaultErrorResolvers,
	onRouteChange,
}: RouterHostProps) {
	const [pageKey, setPageKey] = useState(0);
	const createPage = useCallback(
		async (
			_pathname: string,
			routes: typeof _ROUTES_,
			provided_layouts?: Array<
				(props: { children: JSX.Element }) => JSX.Element
			>,
		) => {
			const matched = router.match(_pathname);
			if (!matched) {
				console.error("No route matched for pathname:", _pathname);
				console.error("Available routes:", routes);
				return await getNotFoundComponent(_pathname);
			}
			const layouts =
				provided_layouts ??
				(await getRelatedLayoutFromPathname(matched.name, routes));
			const Page = await routes[matched.name]?.();

			if (!Page) return await getNotFoundComponent(_pathname);

			return () => (
				<WrapWithLayouts layouts={layouts}>
					<Page />
				</WrapWithLayouts>
			);
		},
		[],
	);
	const [CurrentPage, _setCurrentPage] = useState<() => JSX.Element>(
		() => children,
	);
	const setCurrentPage = useCallback<
		(pathname: string, routes: typeof _ROUTES_) => void
	>(
		async (pathname, routes) => {
			const [Layouts, LoadingComponent] = await Promise.all([
				getRelatedLayoutFromPathname(pathname, routes),
				getLoadingComponent(pathname),
			]);
			_setCurrentPage(() => (
				<WrapWithLayouts layouts={Layouts}>
					<LoadingComponent />
				</WrapWithLayouts>
			));
			await onRouteChange?.(router.match(pathname) as MatchedRoute);
			const PageElement = await createPage(pathname, routes, Layouts);
			_setCurrentPage(() => <PageElement />);
			setPageKey((k) => k + 1);
		},
		[createPage, onRouteChange],
	);
	const [routes, setRoutes] = useState(
		typeof window === "undefined" ? {} : _ROUTES_,
	);

	// Eagerly import all loading components on mount so they're in the module
	// cache before any navigation occurs. This ensures getLoadingComponent()
	// resolves instantly (from cache) when the user clicks a link.
	useEffect(() => {
		Object.entries(_ROUTES_).forEach(([pathname, importer]) => {
			if (pathname.endsWith("/loading")) importer?.();
		});
	}, []);

	// HMR setup - listens for route changes from the HMR system and updates the route components in state without a full reload
	useEffect(
		() =>
			HMR_ENABLED
				? setupHMR((newRoutes) => {
						setRoutes((curr) => {
							setCurrentPage(window.location.pathname, {
								...curr,
								[newRoutes.pathname]: newRoutes.component,
							});
							return { ...curr, [newRoutes.pathname]: newRoutes.component };
						});
					})
				: undefined,
		[setCurrentPage],
	);

	useEffect(() => {
		const popStateHandler = async () => {
			setCurrentPage(window.location.pathname, routes);
		};

		const clickHandler = async (e: MouseEvent) => {
			if (e.ctrlKey) return;

			const target = e.target as HTMLElement;
			const anchor = target.closest("a");

			// Only handle clicks on anchor tags without target="_blank" or empty href
			if (!anchor?.href || anchor.target === "_blank") return;

			const url = new URL(anchor.href);

			// Only handle internal links (same origin)
			if (url.origin !== window.location.origin) return;

			const matched = router.match(url.pathname);
			if (!matched) {
				e.preventDefault();
				console.log("not found no match for url:", url.pathname);
				window.history.pushState(
					null,
					"",
					url.pathname + url.search + url.hash,
				);

				setCurrentPage(url.pathname, routes);
				return;
			} else {
				url.pathname = matched.pathname;
			}

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
			if (routes[matched.name]) {
				// Update browser history with full URL including hash
				window.history.pushState(
					null,
					"",
					url.pathname + url.search + url.hash,
				);
				// Update current page
				setCurrentPage(url.pathname, routes);

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
		};

		window.addEventListener("popstate", popStateHandler);
		document.addEventListener("click", clickHandler);

		return () => {
			window.removeEventListener("popstate", popStateHandler);
			document.removeEventListener("click", clickHandler);
		};
	}, [routes, setCurrentPage]);

	return (
		<ErrorWrapper key={pageKey} resolvers={errorResolvers}>
			{CurrentPage as unknown as JSX.Element}
		</ErrorWrapper>
	);
}

async function getLoadingComponent(pathname: string) {
	// look for a loading.tsx at the same directory level as the requested page
	const pathnameToLoading = pathname.replace(/\/?[^\/]*$/, "/loading");
	const siblingLoader = _ROUTES_[pathnameToLoading];
	const LoadingPage = siblingLoader
		? ((await siblingLoader?.()) ?? FallbackDefaultLoading)
		: FallbackDefaultLoading;
	return () => <LoadingPage />;
}

async function getNotFoundComponent(pathname: string) {
	// must fit the same level as the requested page, so we replace the last segment with 404
	const pathnameTo404 = pathname.replace(/\/?[^\/]*$/, "/404");
	const sibling404 = _ROUTES_[pathnameTo404];
	const NotFoundPage = sibling404
		? ((await sibling404?.()) ?? FallbackDefault404)
		: FallbackDefault404;
	return () => <NotFoundPage />;
}
