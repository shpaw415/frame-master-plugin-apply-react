import { useCallback, useEffect, useState, type JSX } from "react";
import { setupHMR } from "./HMR";
import { getRelatedLayoutFromPathname, WrapWithLayouts } from "./layout";

const _ROUTES_ = (await import(
  "/routes/client:routes" as string
)) as typeof import("routes/client:routes").default;
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
    () => children
  );
  const [routes, setRoutes] = useState(
    typeof window == "undefined" ? {} : _ROUTES_
  );

  const createPage = useCallback(
    (pathname: string, routes: typeof _ROUTES_) => {
      const layouts = getRelatedLayoutFromPathname(pathname);
      const Page = routes[pathname]!;
      return () => (
        <WrapWithLayouts layouts={layouts}>
          <Page />
        </WrapWithLayouts>
      );
    },
    [routes]
  );

  useEffect(
    () =>
      globalThis.HMR_ENABLED
        ? setupHMR((newRoutes) => {
            setRoutes(newRoutes);
            setCurrentPage(createPage(window.location.pathname, newRoutes));
          })
        : undefined,
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
          // Handle hash-only links (anchors on the same page)
          if (url.pathname === window.location.pathname && url.hash) {
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
              url.pathname + url.search + url.hash
            );
            // Update current page
            setCurrentPage(createPage(window.location.pathname, routes));

            // Handle hash scrolling after navigation
            if (url.hash) {
              // Use setTimeout to allow the page to render first
              setTimeout(() => {
                const element = document.getElementById(url.hash.slice(1));
                if (element) {
                  element.scrollIntoView({ behavior: "smooth" });
                }
              }, 0);
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
