import FallbackDefault404 from "@apply-react/404.tsx";
import _ROUTES_ from "@apply-react/client-routes.ts";
import IS_DEVELOPMENT from "@apply-react/development-mode.ts";
import FAST_REFRESH_ENABLED from "@apply-react/fast-refresh-enabled.ts";
import HMR_ENABLED from "@apply-react/HMR-enabled.ts";
import FallbackDefaultLoading from "@apply-react/loading.tsx";
import {
	FileSystemRouter,
	type MatchedRoute,
} from "bun-file-system-router-browser";
import {
	Component,
	type ErrorInfo,
	type JSX,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { requestDevRouteBuild, setupHMR } from "./HMR";
import {
	getRelatedLayoutEntriesFromPathname,
	LayoutCache,
	type LayoutEntry,
	WrapWithLayouts,
} from "./layout";
import { getLocationHref, isSameLocation, NotFoundError } from "./utils";

export const router = new FileSystemRouter({
	routes: Object.keys(_ROUTES_),
	style: "nextjs",
});

/**
 * Resolver function for mapping a thrown error to a fallback page component.
 * Return the fallback component, or `null` to let the next resolver handle it.
 */
export type ErrorFallbackResolver = (
	error: Error,
	pathname: string,
	Layouts: (props: { children: JSX.Element }) => JSX.Element | null,
) => Promise<(() => JSX.Element) | null>;

export type RouterErrorFallbackProps = {
	error: Error;
	componentStack: string | null;
	pathname: string;
	reset: () => void;
};

export type RouterErrorFallback = (
	props: RouterErrorFallbackProps,
) => JSX.Element | null;

export type RouterErrorContext = {
	pathname: string;
	componentStack: string | null;
};

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

type PageComponent = () => JSX.Element;

type RouteResolution =
	| {
			status: "ready";
			Page: PageComponent;
	  }
	| {
			status: "not-found";
			Page: PageComponent;
	  }
	| {
			status: "awaiting-dev-build";
			matched: MatchedRoute;
	  };

type PendingDevRoute = {
	pathname: string;
	routeName: string;
	navigationId: number;
};

type BuildNoticeState = {
	pathname: string;
	visible: boolean;
} | null;

export type DevBuildNotifierProps = {
	pathname: string | null;
	visible: boolean;
};

type InitialRouteSnapshot = {
	pathname: string;
	layouts: LayoutEntry[];
	Page: PageComponent;
};

let initialRouteSnapshot: InitialRouteSnapshot | null = null;

export function setInitialRouteSnapshot(snapshot: InitialRouteSnapshot | null) {
	initialRouteSnapshot = snapshot;
}

interface ErrorWrapperProps {
	children: JSX.Element;
	resolvers: ErrorFallbackResolver[];
	errorFallback?: RouterErrorFallback;
	onError?: (error: Error, context: RouterErrorContext) => void;
}

interface ErrorWrapperState {
	error: Error | null;
	FallbackComponent: (() => JSX.Element) | null;
	componentStack: string | null;
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
	override state: ErrorWrapperState = {
		error: null,
		FallbackComponent: null,
		componentStack: null,
	};

	static getDerivedStateFromError(error: Error): Partial<ErrorWrapperState> {
		return { error, FallbackComponent: null, componentStack: null };
	}

	reset = () => {
		this.setState({
			error: null,
			FallbackComponent: null,
			componentStack: null,
		});
	};

	override async componentDidCatch(error: Error, errorInfo?: ErrorInfo) {
		const pathname = globalThis?.location?.pathname ?? "/";
		const context = {
			pathname,
			componentStack: errorInfo?.componentStack ?? null,
		};
		this.setState({ componentStack: context.componentStack });

		try {
			this.props.onError?.(error, context);
		} catch (reportError) {
			console.error("[Apply-React] Router error reporter failed", reportError);
		}

		for (const resolver of this.props.resolvers) {
			const fallback = await resolver(
				error,
				pathname,
				({ children }: { children: JSX.Element }) => children,
			);
			if (fallback) {
				this.setState({ FallbackComponent: fallback });
				return;
			}
		}

		if (this.props.errorFallback) {
			const ErrorFallback = this.props.errorFallback;
			this.setState({
				FallbackComponent: () => (
					<ErrorFallback
						error={error}
						componentStack={context.componentStack}
						pathname={pathname}
						reset={this.reset}
					/>
				),
			});
		}
	}

	override render() {
		if (this.state.error) {
			if (this.state.FallbackComponent) {
				const Fallback = this.state.FallbackComponent;
				return <Fallback />;
			}
			return (
				<DefaultRouterErrorFallback
					error={this.state.error}
					componentStack={this.state.componentStack}
					pathname={globalThis?.location?.pathname ?? "/"}
					reset={this.reset}
				/>
			);
		}
		return this.props.children;
	}
}

function DefaultRouterErrorFallback({
	error,
	componentStack,
	pathname,
	reset,
}: RouterErrorFallbackProps) {
	const showDetails = IS_DEVELOPMENT;
	const details = [
		`${error.name}: ${error.message}`,
		`Pathname: ${pathname}`,
		componentStack ?? error.stack ?? "",
	]
		.filter(Boolean)
		.join("\n\n");

	const copyDetails = () => {
		void navigator.clipboard?.writeText(details);
	};

	return (
		<div
			role="alert"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9999,
				display: "grid",
				placeItems: "center",
				padding: "1.5rem",
				background: "rgba(12, 14, 18, 0.9)",
				color: "#f8fafc",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
			}}
		>
			<section
				style={{
					width: "min(48rem, 100%)",
					maxHeight: "calc(100vh - 3rem)",
					overflow: "auto",
					border: "1px solid rgba(248, 113, 113, 0.55)",
					borderRadius: "6px",
					background: "#17191f",
					boxShadow: "0 20px 60px rgba(0, 0, 0, 0.45)",
					padding: "1.25rem",
				}}
			>
				<h1 style={{ margin: 0, fontSize: "1.05rem" }}>
					{showDetails ? "Route render failed" : "Something went wrong"}
				</h1>
				{showDetails ? (
					<>
						<p style={{ color: "#fca5a5", margin: "0.75rem 0" }}>
							{error.message}
						</p>
						<details>
							<summary>Error details</summary>
							<pre
								style={{
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									fontSize: "0.75rem",
								}}
							>
								{details}
							</pre>
						</details>
					</>
				) : (
					<p>Try again or reload the page.</p>
				)}
				<div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
					<button type="button" onClick={reset}>
						Retry
					</button>
					<button type="button" onClick={() => window.location.reload()}>
						Reload
					</button>
					{showDetails ? (
						<button type="button" onClick={copyDetails}>
							Copy details
						</button>
					) : null}
				</div>
			</section>
		</div>
	);
}

export type RouterHostProps = {
	children: JSX.Element;
	/** Override or extend the error-to-fallback-page resolver chain. */
	errorResolvers?: ErrorFallbackResolver[];
	/** Rendered after no error resolver handles a thrown route error. */
	errorFallback?: RouterErrorFallback;
	/** Called with route error details for logging or error reporting. */
	onError?: (error: Error, context: RouterErrorContext) => void;
	/** Callback invoked on every route change. */
	onRouteChange?: (route: MatchedRoute) => void | Promise<void>;
	/** Custom component rendered while a dev-only route build is pending. */
	buildNotifier?: (props: DevBuildNotifierProps) => JSX.Element | null;
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
	errorFallback,
	onError,
	onRouteChange,
	buildNotifier: BuildNotifier = DefaultBuildNotifier,
}: RouterHostProps) {
	const initialSnapshot =
		typeof window === "undefined"
			? null
			: initialRouteSnapshot?.pathname === window.location.pathname
				? initialRouteSnapshot
				: null;
	const navigationRef = useRef(0);
	const pendingDevRouteRef = useRef<PendingDevRoute | null>(null);
	const buildNoticeTimeoutRef = useRef<number | null>(null);
	const [pageKey, setPageKey] = useState(0);
	const [activeLayouts, setActiveLayouts] = useState<LayoutEntry[]>(
		() => initialSnapshot?.layouts ?? [],
	);
	const [buildNotice, setBuildNotice] = useState<BuildNoticeState>(null);
	const showBuildNotice = useCallback((pathname: string) => {
		if (buildNoticeTimeoutRef.current) {
			window.clearTimeout(buildNoticeTimeoutRef.current);
			buildNoticeTimeoutRef.current = null;
		}

		setBuildNotice({ pathname, visible: true });
	}, []);
	const hideBuildNotice = useCallback(() => {
		setBuildNotice((current) => {
			if (!current) return current;
			return { ...current, visible: false };
		});

		if (buildNoticeTimeoutRef.current) {
			window.clearTimeout(buildNoticeTimeoutRef.current);
		}

		buildNoticeTimeoutRef.current = window.setTimeout(() => {
			setBuildNotice(null);
			buildNoticeTimeoutRef.current = null;
		}, 240);
	}, []);
	const resolveRoute = useCallback(
		async (
			pathname: string,
			routes: typeof _ROUTES_,
		): Promise<RouteResolution> => {
			const matched = router.match(pathname);
			if (!matched) {
				console.error("No route matched for pathname:", pathname);
				console.error("Available routes:", routes);
				return {
					status: "not-found",
					Page: await getNotFoundComponent(pathname),
				};
			}

			const importer = routes[matched.name];
			if (!importer) {
				return HMR_ENABLED
					? { status: "awaiting-dev-build", matched }
					: {
							status: "not-found",
							Page: await getNotFoundComponent(pathname),
						};
			}

			try {
				const Page = await importer();
				if (!Page) {
					return {
						status: "not-found",
						Page: await getNotFoundComponent(pathname),
					};
				}

				return {
					status: "ready",
					Page: Page as PageComponent,
				};
			} catch (error) {
				if (HMR_ENABLED && isMissingRouteModuleError(error)) {
					return { status: "awaiting-dev-build", matched };
				}

				throw error;
			}
		},
		[],
	);
	const [CurrentPage, _setCurrentPage] = useState<PageComponent>(
		() => initialSnapshot?.Page ?? (() => children),
	);
	const setNotFoundPage = useCallback(
		async (pathname: string, navigationId: number) => {
			pendingDevRouteRef.current = null;
			hideBuildNotice();
			setActiveLayouts([]);
			const NotFoundPage = await getNotFoundComponent(pathname);
			if (navigationRef.current !== navigationId) return;
			_setCurrentPage(() => NotFoundPage);
			setPageKey(navigationId);
		},
		[hideBuildNotice],
	);
	const requestPendingRouteBuild = useCallback(
		async (matched: MatchedRoute, navigationId: number) => {
			pendingDevRouteRef.current = {
				pathname: matched.pathname,
				routeName: matched.name,
				navigationId,
			};
			showBuildNotice(matched.pathname);

			const result = await requestDevRouteBuild(matched.pathname);
			if (result.status === "missing") {
				await setNotFoundPage(result.pathname, navigationId);
			}
		},
		[setNotFoundPage, showBuildNotice],
	);
	const setCurrentPage = useCallback<
		(pathname: string, routes: typeof _ROUTES_) => void
	>(
		async (pathname, routes) => {
			const navigationId = navigationRef.current + 1;
			navigationRef.current = navigationId;

			const matched = router.match(pathname);

			if (!matched) {
				await setNotFoundPage(pathname, navigationId);
				return;
			}

			const [layouts, LoadingComponent] = await Promise.all([
				getRelatedLayoutEntriesFromPathname(pathname, routes),
				getLoadingComponent(pathname),
			]);
			if (navigationRef.current !== navigationId) return;
			setActiveLayouts(layouts);
			_setCurrentPage(() => LoadingComponent);
			setPageKey(navigationId);
			await onRouteChange?.(matched as MatchedRoute);
			if (navigationRef.current !== navigationId) return;
			const resolvedRoute = await resolveRoute(pathname, routes);
			if (navigationRef.current !== navigationId) return;

			switch (resolvedRoute.status) {
				case "ready":
					pendingDevRouteRef.current = null;
					hideBuildNotice();
					_setCurrentPage(() => resolvedRoute.Page);
					return;
				case "not-found":
					pendingDevRouteRef.current = null;
					hideBuildNotice();
					_setCurrentPage(() => resolvedRoute.Page);
					return;
				case "awaiting-dev-build":
					await requestPendingRouteBuild(resolvedRoute.matched, navigationId);
					return;
				default:
					return;
			}
		},
		[
			hideBuildNotice,
			onRouteChange,
			requestPendingRouteBuild,
			resolveRoute,
			setNotFoundPage,
		],
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

	// HMR setup - uses React Refresh when enabled, otherwise replaces the route.
	useEffect(
		() =>
			HMR_ENABLED
				? setupHMR({
						onRouteBuildStarted: ({ pathname, routeName }) => {
							const pendingRoute = pendingDevRouteRef.current;
							if (!pendingRoute || pendingRoute.routeName !== routeName) return;
							showBuildNotice(pathname);
						},
						onRoutesUpdate: async (newRoutes) => {
							const safeComponentLoader = () =>
								newRoutes.component().catch((error) => {
									console.error(
										"[Apply-React HMR] Failed to import hot route update, reloading page",
										error,
									);
									window.location.reload();
									throw error;
								});
							const activeRoute = router.match(window.location.pathname);
							const pendingRoute = pendingDevRouteRef.current;
							const isPendingRoute =
								pendingRoute?.routeName === newRoutes.routeName;
							const isActiveRoute = activeRoute?.name === newRoutes.routeName;

							if (FAST_REFRESH_ENABLED && isActiveRoute) {
								// Re-import so $RefreshReg$ runs; performReactRefresh (in HMR)
								// patches fibers in place. Do not bump pageKey — that remounts
								// ErrorWrapper, keeps a stale CurrentPage, and wipes hook state.
								await safeComponentLoader();
							}

							setRoutes((curr) => {
								const nextRoutes = {
									...curr,
									[newRoutes.routeName]: safeComponentLoader,
								};
								if (isPendingRoute && pendingRoute) {
									pendingDevRouteRef.current = null;
									setCurrentPage(pendingRoute.pathname, nextRoutes);
								} else if (!FAST_REFRESH_ENABLED) {
									LayoutCache.clear();
									setCurrentPage(window.location.pathname, nextRoutes);
								}

								return nextRoutes;
							});
						},
						onRouteBuildMissing: ({ pathname }) => {
							const pendingRoute = pendingDevRouteRef.current;
							if (!pendingRoute || pendingRoute.pathname !== pathname) return;
							void setNotFoundPage(pathname, pendingRoute.navigationId);
						},
					})
				: undefined,
		[setCurrentPage, setNotFoundPage, showBuildNotice],
	);

	useEffect(
		() => () => {
			if (buildNoticeTimeoutRef.current) {
				window.clearTimeout(buildNoticeTimeoutRef.current);
			}
		},
		[],
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
			const currentLocation = getLocationHref(window.location);

			// Only handle internal links (same origin)
			if (url.origin !== window.location.origin) return;

			const matched = router.match(url.pathname);
			if (!matched) {
				const nextLocation = getLocationHref(url);
				if (nextLocation === currentLocation) {
					e.preventDefault();
					return;
				}

				e.preventDefault();
				console.log("not found no match for url:", url.pathname);
				if (nextLocation !== currentLocation) {
					window.history.pushState(null, "", nextLocation);
				}

				setCurrentPage(url.pathname, routes);
				return;
			}

			url.pathname = matched.pathname;
			const nextLocation = getLocationHref(url);

			if (isSameLocation(window.location, url)) {
				e.preventDefault();
				return;
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

			// Update browser history with full URL including hash
			if (nextLocation !== currentLocation) {
				window.history.pushState(null, "", nextLocation);
			}
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
		};

		window.addEventListener("popstate", popStateHandler);
		document.addEventListener("click", clickHandler);

		return () => {
			window.removeEventListener("popstate", popStateHandler);
			document.removeEventListener("click", clickHandler);
		};
	}, [routes, setCurrentPage]);

	return (
		<>
			<WrapWithLayouts layouts={activeLayouts}>
				<ErrorWrapper
					key={pageKey}
					resolvers={errorResolvers}
					errorFallback={errorFallback}
					onError={onError}
				>
					<CurrentPage />
				</ErrorWrapper>
			</WrapWithLayouts>
			<BuildNotifier
				pathname={buildNotice?.pathname ?? null}
				visible={buildNotice?.visible ?? false}
			/>
		</>
	);
}

async function getLoadingComponent(pathname: string) {
	// look for a loading.tsx at the same directory level as the requested page
	const pathnameToLoading = pathname.replace(/\/?[^/]*$/, "/loading");
	const siblingLoader = _ROUTES_[pathnameToLoading];
	const LoadingPage = siblingLoader
		? ((await siblingLoader?.()) ?? FallbackDefaultLoading)
		: FallbackDefaultLoading;
	return () => <LoadingPage />;
}

async function getNotFoundComponent(pathname: string) {
	// must fit the same level as the requested page, so we replace the last segment with 404
	const pathnameTo404 = pathname.replace(/\/?[^/]*$/, "/404");
	const sibling404 = _ROUTES_[pathnameTo404];
	const NotFoundPage = sibling404
		? ((await sibling404?.()) ?? FallbackDefault404)
		: FallbackDefault404;
	return () => <NotFoundPage />;
}

function isMissingRouteModuleError(error: unknown) {
	if (!(error instanceof Error)) return false;

	const message = error.message.toLowerCase();
	return (
		message.includes("module not found") ||
		message.includes("cannot find module") ||
		message.includes("failed to fetch dynamically imported module") ||
		(message.includes("import") && message.includes("404")) ||
		(message.includes("import") && message.includes("not found"))
	);
}

function DefaultBuildNotifier({ pathname, visible }: DevBuildNotifierProps) {
	if (!pathname) return null;

	return (
		<>
			<style>{`
				@keyframes _ar_spin {
					to { transform: rotate(360deg); }
				}
			`}</style>
			<div
				aria-live="polite"
				role="status"
				style={{
					position: "fixed",
					bottom: "1.5rem",
					right: "1.5rem",
					zIndex: 9999,
					display: "flex",
					alignItems: "center",
					gap: "0.55rem",
					padding: "0.5rem 0.85rem 0.5rem 0.6rem",
					borderRadius: "999px",
					border: "1px solid rgba(255,255,255,0.08)",
					background: "rgba(15, 17, 21, 0.82)",
					boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
					color: "rgba(226, 232, 240, 0.88)",
					fontSize: "0.8rem",
					letterSpacing: "0.01em",
					fontFamily: "system-ui, sans-serif",
					backdropFilter: "blur(10px)",
					transform: visible
						? "translateY(0)"
						: "translateY(calc(100% + 1.5rem))",
					opacity: visible ? 1 : 0,
					transition:
						"transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease",
					pointerEvents: "none",
					userSelect: "none",
				}}
			>
				<svg
					aria-hidden="true"
					width="13"
					height="13"
					viewBox="0 0 13 13"
					fill="none"
					style={{ animation: "_ar_spin 0.9s linear infinite", flexShrink: 0 }}
				>
					<circle
						cx="6.5"
						cy="6.5"
						r="5.5"
						stroke="rgba(226,232,240,0.22)"
						strokeWidth="1.5"
					/>
					<path
						d="M6.5 1A5.5 5.5 0 0 1 12 6.5"
						stroke="rgba(148,163,184,0.9)"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
				<span>
					Building{" "}
					<span
						style={{
							color: "rgba(255,255,255,0.65)",
							fontFamily: "ui-monospace, monospace",
							fontSize: "0.77rem",
						}}
					>
						{pathname}
					</span>
				</span>
			</div>
		</>
	);
}
