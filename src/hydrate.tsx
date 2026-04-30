import _ROUTES_ from "@apply-react/client-routes.ts";
import Shell from "@apply-react/client-shell.tsx";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { getRelatedLayoutFromPathname } from "./layout";
import { router } from "./utils";

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

		const pathname = matched.pathname;

		const PageToRender = await _ROUTES_[pathname]?.();
		if (!PageToRender) {
			console.error("No page found for pathname:", window.location.pathname);
			console.error("Available routes:", _ROUTES_);
			throw new Error("pathname does not exists");
		}
		const WrappedPage = (await getRelatedLayoutFromPathname(pathname, _ROUTES_))
			.reverse()
			.reduce(
				(Prev, Curr) => <Curr key={Curr.toString()}>{Prev}</Curr>,
				<PageToRender />,
			);

		hydrateRoot(
			rootElement,
			<StrictMode>
				<Shell>{WrappedPage}</Shell>
			</StrictMode>,
		);
	}
}
