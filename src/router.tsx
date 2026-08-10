import FallbackDefault404 from "@apply-react/404.tsx";
import _ROUTES_ from "@apply-react/client-routes.ts";
import HMR_ENABLED from "@apply-react/HMR-enabled.ts";
import FallbackDefaultLoading from "@apply-react/loading.tsx";
import {
	FileSystemRouter,
	type MatchedRoute,
} from "bun-file-system-router-browser";
import {
	Component,
	type CSSProperties,
	type JSX,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import ApplyReactPluginOptions from "@apply-react/props.ts";
import {
	type HmrConnectionStatus,
	reportActivePathname,
	requestDevRouteBuild,
	setupHMR,
} from "./HMR";
import { isSpecialRouteName } from "./hmr/watch";
import {
	getRelatedLayoutEntriesFromPathname,
	invalidateLayoutCache,
	LayoutCache,
	type LayoutEntry,
	WrapWithLayouts,
} from "./layout";
import { getLocationHref, isSameLocation, NotFoundError } from "./utils";

const PRESERVE_STATE =
	(ApplyReactPluginOptions as { hmr?: { preserveState?: boolean } })?.hmr
		?.preserveState !== false;

/** Map moduleRoot-relative path to FS-router special/page key segment */
function modPathToRouteKey(path: string): string {
	const stripped = path
		.replace(/\\/g, "/")
		.replace(/^(pages|page)\//, "")
		.replace(/\.(tsx|jsx|ts|js)$/i, "");
	return stripped.startsWith("/") ? stripped : `/${stripped || ""}`;
}

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
	status?: HmrConnectionStatus | "building" | "failed" | "live";
	errorMessage?: string | null;
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
	/** Custom component rendered while a dev-only route build is pending. */
	buildNotifier?: (props: DevBuildNotifierProps) => JSX.Element | null;
	/** Show HMR error overlay (default true in dev). */
	hmrOverlay?: boolean;
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
	buildNotifier: BuildNotifier = DefaultBuildNotifier,
	hmrOverlay = true,
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
	const lastGenerationRef = useRef(0);
	const softFailCountRef = useRef(0);
	/** True while applying an HMR update — blocks requestDevRouteBuild loops. */
	const hmrApplyingRef = useRef(false);
	const appliedHmrKeysRef = useRef(new Set<string>());
	const routesRef = useRef(typeof window === "undefined" ? {} : _ROUTES_);
	const setCurrentPageRef = useRef<
		(pathname: string, routes: typeof _ROUTES_) => void
	>(() => {});
	const [pageKey, setPageKey] = useState(0);
	const [activeLayouts, setActiveLayouts] = useState<LayoutEntry[]>(
		() => initialSnapshot?.layouts ?? [],
	);
	const [buildNotice, setBuildNotice] = useState<BuildNoticeState>(null);
	const [hmrStatus, setHmrStatus] = useState<
		HmrConnectionStatus | "building" | "failed" | "live"
	>("live");
	const [hmrError, setHmrError] = useState<string | null>(null);
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
				// During HMR apply, never ask the server to rebuild — that loops.
				if (HMR_ENABLED && !hmrApplyingRef.current) {
					return { status: "awaiting-dev-build", matched };
				}
				return {
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
					Page: () => <Page />,
				};
			} catch (error) {
				if (
					HMR_ENABLED &&
					!hmrApplyingRef.current &&
					isMissingRouteModuleError(error)
				) {
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

			// Merge static route table with HMR-updated importers so layouts/404s
			// never disappear when selective client state is partial.
			const routeTable = { ..._ROUTES_, ...routes };
			const [layouts, LoadingComponent] = await Promise.all([
				getRelatedLayoutEntriesFromPathname(pathname, routeTable),
				getLoadingComponent(pathname),
			]);
			if (navigationRef.current !== navigationId) return;

			setActiveLayouts(layouts);
			// Reset error boundary on every navigation. Prefer keeping the previous
			// page visible when the loading fallback renders null (common default).
			setPageKey(navigationId);
			_setCurrentPage(() => LoadingComponent);

			if (navigationRef.current !== navigationId) return;
			const resolvedRoute = await resolveRoute(pathname, routeTable);
			if (navigationRef.current !== navigationId) return;

			switch (resolvedRoute.status) {
				case "ready":
					pendingDevRouteRef.current = null;
					hideBuildNotice();
					_setCurrentPage(() => resolvedRoute.Page);
					if (HMR_ENABLED) reportActivePathname(pathname);
					await onRouteChange?.(matched as MatchedRoute);
					return;
				case "not-found":
					pendingDevRouteRef.current = null;
					hideBuildNotice();
					_setCurrentPage(() => resolvedRoute.Page);
					if (HMR_ENABLED) reportActivePathname(pathname);
					await onRouteChange?.(matched as MatchedRoute);
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
	routesRef.current = routes;
	setCurrentPageRef.current = setCurrentPage;

	// Eagerly import all loading components on mount so they're in the module
	// cache before any navigation occurs. This ensures getLoadingComponent()
	// resolves instantly (from cache) when the user clicks a link.
	useEffect(() => {
		Object.entries(_ROUTES_).forEach(([pathname, importer]) => {
			if (pathname.endsWith("/loading")) importer?.();
		});
	}, []);

	// HMR setup once — callbacks use refs so identity changes cannot re-subscribe
	// (re-subscribe was a source of client-side update loops).
	useEffect(() => {
		if (!HMR_ENABLED) return;

		const applyHotUpdate = async (newRoutes: {
			pathname: string;
			routeName: string;
			generation: number;
			component: () => Promise<() => JSX.Element>;
		}) => {
			const applyKey = `${newRoutes.generation}:${newRoutes.routeName}:${newRoutes.pathname}`;
			if (newRoutes.generation < lastGenerationRef.current) return;
			if (appliedHmrKeysRef.current.has(applyKey)) return;
			// Cap set size
			if (appliedHmrKeysRef.current.size > 100) {
				appliedHmrKeysRef.current.clear();
			}
			appliedHmrKeysRef.current.add(applyKey);
			if (newRoutes.generation > lastGenerationRef.current) {
				lastGenerationRef.current = newRoutes.generation;
			}

			// Layout/loading/404 — swap shell importers and remount under new layouts
			if (isSpecialRouteName(newRoutes.routeName)) {
				if (hmrApplyingRef.current) return;
				hmrApplyingRef.current = true;
				try {
					// Verify the hot shell module loads
					const HotShell = await newRoutes.component();
					if (!HotShell) throw new Error("Hot shell exported empty default");

					LayoutCache.delete(newRoutes.routeName);
					const next = {
						...routesRef.current,
						// Prefer resolved component so layout does not re-fetch a stale URL
						[newRoutes.routeName]: async () => HotShell,
					};
					routesRef.current = next;
					setRoutes(next);

					const layouts = await getRelatedLayoutEntriesFromPathname(
						window.location.pathname,
						next,
					);
					setActiveLayouts(layouts);
					// Force ErrorWrapper + page tree to remount under new Layout instances
					setPageKey((k) => k + 1);
					hideBuildNotice();
					setHmrStatus("live");
					setHmrError(null);
					softFailCountRef.current = 0;
				} catch (error) {
					console.error("[Apply-React HMR] Layout/shell update failed", error);
					// Fall back: clear cache and remount current page once
					LayoutCache.clear();
					setPageKey((k) => k + 1);
					try {
						await setCurrentPageRef.current(
							window.location.pathname,
							routesRef.current,
						);
					} catch {
						// ignore
					}
					hideBuildNotice();
					setHmrStatus("live");
				} finally {
					hmrApplyingRef.current = false;
				}
				return;
			}

			if (hmrApplyingRef.current) return;
			hmrApplyingRef.current = true;
			setHmrError(null);

			try {
				const HotPage = await newRoutes.component();
				if (!HotPage) throw new Error("Hot module exported empty default");

				// Page-only: do not clear layout cache (preserves layout module identity)
				const nextRoutes = {
					...routesRef.current,
					[newRoutes.routeName]: newRoutes.component,
				};
				setRoutes(nextRoutes);
				routesRef.current = nextRoutes;

				const pendingRoute = pendingDevRouteRef.current;
				const currentName = router.match(window.location.pathname)?.name;

				if (pendingRoute?.routeName === newRoutes.routeName) {
					pendingDevRouteRef.current = null;
					_setCurrentPage(() => () => <HotPage />);
					if (!PRESERVE_STATE) setPageKey((k) => k + 1);
				} else if (currentName === newRoutes.routeName) {
					_setCurrentPage(() => () => <HotPage />);
					if (!PRESERVE_STATE) setPageKey((k) => k + 1);
				} else {
					// Different route finished building — only refresh registry.
				}

				softFailCountRef.current = 0;
				hideBuildNotice();
				setHmrStatus("live");
			} catch (error) {
				console.error(
					"[Apply-React HMR] Soft update failed, attempting remount",
					error,
				);
				softFailCountRef.current += 1;
				try {
					LayoutCache.clear();
					const nextRoutes = {
						...routesRef.current,
						[newRoutes.routeName]: newRoutes.component,
					};
					setRoutes(nextRoutes);
					routesRef.current = nextRoutes;
					setPageKey((k) => k + 1);
					// Remount current page from registry — still no requestDevRouteBuild
					const resolved = await resolveRoute(
						window.location.pathname,
						nextRoutes,
					);
					if (resolved.status === "ready" || resolved.status === "not-found") {
						_setCurrentPage(() => resolved.Page);
					}
					softFailCountRef.current = 0;
					hideBuildNotice();
					setHmrStatus("live");
				} catch (remountError) {
					console.error(
						"[Apply-React HMR] Remount failed, full reload",
						remountError,
					);
					// Only hard-reload once after repeated soft failures
					if (softFailCountRef.current >= 2) {
						window.location.reload();
					}
				}
			} finally {
				hmrApplyingRef.current = false;
			}
		};

		return setupHMR({
			onStatusChange: (status) => {
				setHmrStatus((prev) =>
					prev === "building" || prev === "failed" ? prev : status,
				);
			},
			getPathname: () => window.location.pathname,
			onRouteBuildStarted: ({ pathname, routeName, generation }) => {
				if (generation < lastGenerationRef.current) return;
				const pendingRoute = pendingDevRouteRef.current;
				if (pendingRoute && pendingRoute.routeName !== routeName) return;
				setHmrStatus("building");
				setHmrError(null);
				showBuildNotice(pathname);
			},
			onRoutesUpdate: applyHotUpdate,
			onRouteBuildMissing: ({ pathname, generation }) => {
				if (generation < lastGenerationRef.current) return;
				const pendingRoute = pendingDevRouteRef.current;
				if (!pendingRoute || pendingRoute.pathname !== pathname) return;
				pendingDevRouteRef.current = null;
				hideBuildNotice();
				setHmrStatus("live");
				void setNotFoundPage(pathname, pendingRoute.navigationId);
			},
			onBuildFailed: ({ error, generation }) => {
				if (generation < lastGenerationRef.current) return;
				pendingDevRouteRef.current = null;
				setHmrStatus("failed");
				setHmrError(error.message);
				hideBuildNotice();
			},
			onFullReload: ({ reason }) => {
				console.info("[Apply-React HMR] Full reload:", reason);
				window.location.reload();
			},
			onInvalidateModule: async ({ path, t, generation }) => {
				if (generation < lastGenerationRef.current) return;
				if (generation > lastGenerationRef.current) {
					lastGenerationRef.current = generation;
				}

				const base = path.replace(/\\/g, "/");
				const fileBase = base.split("/").pop() ?? "";
				const isShell =
					/^(layout|loading|404|error|template|not-found)\.(t|j)sx?$/i.test(
						fileBase,
					);
				const looksLikeRouteFile =
					isShell || /(^|\/)(pages|page)\//.test(base);

				// Shared modules (context, utils): full reload so import graph rebinds
				if (!looksLikeRouteFile) {
					console.info(
						"[Apply-React HMR] Non-route module changed, full reload:",
						path,
					);
					window.location.reload();
					return;
				}

				if (hmrApplyingRef.current) return;
				hmrApplyingRef.current = true;
				setHmrStatus("building");
				try {
					// Public mod URLs use .js (not source .tsx); encode [param] segments
					const asJs = base.replace(/\.(tsx|ts|jsx|js|mjs|cjs|mts|cts)$/i, ".js");
					const withJs = asJs.endsWith(".js") ? asJs : `${asJs}.js`;
					const encodedPath = withJs
						.split("/")
						.filter(Boolean)
						.map((seg) => encodeURIComponent(seg))
						.join("/");
					const modUrl = `/@apply-react/mod/${encodedPath}?t=${t}`;
					const mod = await import(/* webpackIgnore: true */ modUrl);
					const Hot = mod.default as (() => JSX.Element) | undefined;
					if (!Hot) throw new Error(`No default export: ${path}`);

					const routeKey = modPathToRouteKey(base);

					if (isShell) {
						invalidateLayoutCache(routeKey);
						const next = {
							...routesRef.current,
							[routeKey]: async () => Hot,
						};
						routesRef.current = next;
						setRoutes(next);
						const layouts = await getRelatedLayoutEntriesFromPathname(
							window.location.pathname,
							next,
						);
						setActiveLayouts(layouts);
						setPageKey((k) => k + 1);
					} else {
						const matched = router.match(window.location.pathname);
						const pageKeyName = matched?.name ?? routeKey;
						const next = {
							...routesRef.current,
							[pageKeyName]: async () => Hot,
						};
						routesRef.current = next;
						setRoutes(next);
						_setCurrentPage(() => () => <Hot />);
						if (!PRESERVE_STATE) setPageKey((k) => k + 1);
					}
					hideBuildNotice();
					setHmrStatus("live");
					setHmrError(null);
				} catch (error) {
					console.error("[Apply-React HMR] invalidate-module failed", error);
					window.location.reload();
				} finally {
					hmrApplyingRef.current = false;
				}
			},
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once HMR
	}, []);

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
			// Leave modified clicks / non-primary button / download to the browser
			// (happy-dom synthetic clicks may omit button — treat missing as primary)
			if (
				e.defaultPrevented ||
				(typeof e.button === "number" && e.button !== 0) ||
				e.metaKey ||
				e.ctrlKey ||
				e.shiftKey ||
				e.altKey
			) {
				return;
			}

			const target = e.target as HTMLElement;
			const anchor = target.closest("a");

			// Only handle clicks on anchor tags without target="_blank" or empty href
			if (!anchor?.href || anchor.target === "_blank") return;
			if (anchor.hasAttribute("download")) return;
			if (anchor.getAttribute("rel")?.split(/\s+/).includes("external"))
				return;

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
				<ErrorWrapper key={pageKey} resolvers={errorResolvers}>
					<CurrentPage />
				</ErrorWrapper>
			</WrapWithLayouts>
			<BuildNotifier
				pathname={buildNotice?.pathname ?? null}
				visible={
					(buildNotice?.visible ?? false) ||
					hmrStatus === "reconnecting" ||
					hmrStatus === "connecting" ||
					hmrStatus === "failed"
				}
				status={hmrStatus}
				errorMessage={hmrError}
			/>
			{hmrOverlay && hmrError ? (
				<HmrErrorOverlay
					message={hmrError}
					onDismiss={() => setHmrError(null)}
					onReload={() => window.location.reload()}
				/>
			) : null}
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

function DefaultBuildNotifier({
	pathname,
	visible,
	status = "building",
	errorMessage,
}: DevBuildNotifierProps) {
	if (!visible && status === "live") return null;

	const label =
		status === "failed"
			? errorMessage
				? `Build failed: ${errorMessage}`
				: "Build failed"
			: status === "reconnecting"
				? "HMR reconnecting…"
				: status === "connecting"
					? "HMR connecting…"
					: status === "building"
						? `Building ${pathname ?? "…"}`
						: pathname
							? `Building ${pathname}`
							: "HMR";

	const showSpinner =
		status === "building" ||
		status === "connecting" ||
		status === "reconnecting";

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
					background:
						status === "failed"
							? "rgba(127, 29, 29, 0.9)"
							: "rgba(15, 17, 21, 0.82)",
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
					maxWidth: "min(420px, calc(100vw - 2rem))",
				}}
			>
				{showSpinner ? (
					<svg
						aria-hidden="true"
						width="13"
						height="13"
						viewBox="0 0 13 13"
						fill="none"
						style={{
							animation: "_ar_spin 0.9s linear infinite",
							flexShrink: 0,
						}}
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
				) : null}
				<span
					style={{
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{label}
				</span>
			</div>
		</>
	);
}

function HmrErrorOverlay({
	message,
	onDismiss,
	onReload,
}: {
	message: string;
	onDismiss: () => void;
	onReload: () => void;
}) {
	return (
		<div
			role="alert"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 10000,
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				padding: "2rem",
				background: "rgba(0,0,0,0.45)",
				fontFamily: "system-ui, sans-serif",
			}}
		>
			<div
				style={{
					width: "min(560px, 100%)",
					marginTop: "10vh",
					background: "#1c1917",
					color: "#fafaf9",
					borderRadius: 12,
					border: "1px solid rgba(248,113,113,0.35)",
					boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
					padding: "1.25rem 1.35rem",
				}}
			>
				<div style={{ fontWeight: 600, marginBottom: 8, color: "#fca5a5" }}>
					Apply-React build failed
				</div>
				<pre
					style={{
						margin: 0,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						fontSize: 13,
						lineHeight: 1.45,
						color: "#e7e5e4",
						maxHeight: 240,
						overflow: "auto",
					}}
				>
					{message}
				</pre>
				<div
					style={{
						display: "flex",
						gap: 8,
						marginTop: 16,
						justifyContent: "flex-end",
					}}
				>
					<button
						type="button"
						onClick={onDismiss}
						style={overlayBtnStyle}
					>
						Dismiss
					</button>
					<button
						type="button"
						onClick={onReload}
						style={{ ...overlayBtnStyle, background: "#b91c1c", border: "none" }}
					>
						Reload
					</button>
				</div>
			</div>
		</div>
	);
}

const overlayBtnStyle: CSSProperties = {
	cursor: "pointer",
	borderRadius: 8,
	padding: "0.4rem 0.75rem",
	border: "1px solid rgba(255,255,255,0.15)",
	background: "transparent",
	color: "#fafaf9",
	fontSize: 13,
};
