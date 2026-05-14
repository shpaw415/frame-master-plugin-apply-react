import _ROUTES_ from "@apply-react/client-routes.ts";
import Shell from "@apply-react/client-shell.tsx";
import { StrictMode } from "react";
import { getRelatedLayoutEntriesFromPathname, WrapWithLayouts } from "./layout";
import { router, setInitialRouteSnapshot } from "./router";
import ApplyReactPluginOptions from "@apply-react/props.ts";
import { createRoot, hydrateRoot } from "react-dom/client";

if (document.readyState !== "loading") {
	Hydrate();
} else {
	document.addEventListener("DOMContentLoaded", Hydrate);
}

async function Hydrate() {
	const rootElement = document.getElementById("root");
	if (rootElement) {
		const matched = router.match(window.location.pathname);

		if (!matched) {
			console.error("No route matched for pathname:", window.location.pathname);
			console.error("Available routes:", _ROUTES_);
			throw new Error("pathname does not exists");
		}

		const routeName = matched.name;

		const PageToRender = await _ROUTES_[routeName]?.();
		if (!PageToRender) {
			console.error("No page found for pathname:", window.location.pathname);
			console.error("Available routes:", _ROUTES_);
			throw new Error("pathname does not exists");
		}
		const layouts = await getRelatedLayoutEntriesFromPathname(
			routeName,
			_ROUTES_,
		);
		setInitialRouteSnapshot({
			pathname: window.location.pathname,
			layouts,
			Page: () => <PageToRender />,
		});
		const WrappedPage = (
			<WrapWithLayouts layouts={layouts}>
				<PageToRender />
			</WrapWithLayouts>
		);

		const PageComponent = (
			<StrictMode>
				<Shell>{WrappedPage}</Shell>
			</StrictMode>
		);

		switch (ApplyReactPluginOptions.hydration) {
			case "hydrate":
				hydrateRoot(rootElement, PageComponent);
				return;
			case "render":
				createRoot(rootElement).render(PageComponent);
				break;
		}
	}
}
