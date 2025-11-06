import { useCallback, useEffect, useState, type JSX } from "react";
import { setupHMR } from "./HMR";
import { getRelatedLayoutFromPathname, WrapWithLayouts } from "./layout";

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
  const [currentPage, setCurrentPage] = useState<JSX.Element>(children);
  const [routes, setRoutes] = useState(
    typeof window == "undefined" ? {} : globalThis._ROUTES_
  );

  const createPage = useCallback(
    (pathname: string, routes: typeof globalThis._ROUTES_) => {
      const layouts = getRelatedLayoutFromPathname(pathname);
      const page = routes[pathname]!();
      return <WrapWithLayouts layouts={layouts}>{page}</WrapWithLayouts>;
    },
    [routes]
  );

  useEffect(
    () =>
      setupHMR((newRoutes) => {
        setRoutes(newRoutes);
        setCurrentPage(createPage(window.location.pathname, newRoutes));
      }),
    []
  );

  useEffect(() => {
    const popStateHandler = () => {
      setCurrentPage(createPage(window.location.pathname, routes));
    };

    const clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");

      if (anchor && anchor.href) {
        const url = new URL(anchor.href);

        // Only handle internal links (same origin)
        if (url.origin === window.location.origin) {
          e.preventDefault();

          // Check if route exists
          if (routes[url.pathname]) {
            // Update browser history
            window.history.pushState(null, "", url.pathname);
            // Update current page
            setCurrentPage(createPage(window.location.pathname, routes));
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

  return currentPage;
}
