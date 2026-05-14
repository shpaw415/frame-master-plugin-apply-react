import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import HomePage from "./src/pages/index";
import routes from "@apply-react/client-routes.ts";
import {
	getRelatedLayoutEntriesFromPathname,
	LayoutCache,
} from "../src/layout";
import { RouterHost, setInitialRouteSnapshot } from "../src/router";

const describeRouterHost =
	typeof document === "undefined" ? describe.skip : describe;

function flushNavigation() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function getInput() {
	return document.querySelector(
		'input[aria-label="layout-state"]',
	) as HTMLInputElement | null;
}

function findLink(href: string) {
	return Array.from(document.querySelectorAll("a")).find(
		(link) => link.getAttribute("href") === href,
	) as HTMLAnchorElement | undefined;
}

describeRouterHost("RouterHost shared layouts", () => {
	let root: Root | undefined;
	let container: HTMLDivElement;

	beforeEach(async () => {
		LayoutCache.clear();
		setInitialRouteSnapshot(null);
		document.body.innerHTML = '<div id="root"></div>';
		container = document.getElementById("root") as HTMLDivElement;
		window.history.replaceState(null, "", "/");

		const layouts = await getRelatedLayoutEntriesFromPathname("/", routes);
		setInitialRouteSnapshot({
			pathname: "/",
			layouts,
			Page: HomePage,
		});

		await act(async () => {
			root = createRoot(container);
			root.render(
				<RouterHost onRouteChange={() => Promise.resolve()}>
					<HomePage />
				</RouterHost>,
			);
			await flushNavigation();
		});
	});

	afterEach(async () => {
		if (!root) return;

		await act(async () => {
			root.unmount();
			await flushNavigation();
		});
		LayoutCache.clear();
		setInitialRouteSnapshot(null);
		document.body.innerHTML = "";
	});

	test("keeps shared layout state when navigating between sibling routes", async () => {
		const input = getInput();
		expect(input).not.toBeNull();
		if (!input) throw new Error("Missing shared layout input");

		await act(async () => {
			input.value = "kept across navigation";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			await flushNavigation();
		});

		const subLink = findLink("/sub");
		expect(subLink).toBeDefined();
		if (!subLink) throw new Error("Missing /sub link");

		await act(async () => {
			subLink.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
			await flushNavigation();
			await flushNavigation();
		});

		expect(document.body.textContent).toContain("Sub Page");
		expect(getInput()?.value).toBe("kept across navigation");
	});

	test("resets page fallback on navigation without remounting the shared layout", async () => {
		const input = getInput();
		expect(input).not.toBeNull();
		if (!input) throw new Error("Missing shared layout input");

		await act(async () => {
			input.value = "kept after fallback";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			await flushNavigation();
		});

		const profileLink = findLink("/profile");
		expect(profileLink).toBeDefined();
		if (!profileLink) throw new Error("Missing /profile link");

		await act(async () => {
			profileLink.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
			await flushNavigation();
			await flushNavigation();
		});

		expect(document.body.textContent).toContain("Default Not Found");
		expect(getInput()?.value).toBe("kept after fallback");

		const homeLink = findLink("/");
		expect(homeLink).toBeDefined();
		if (!homeLink) throw new Error("Missing / link");

		await act(async () => {
			homeLink.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					cancelable: true,
				}),
			);
			await flushNavigation();
			await flushNavigation();
		});

		expect(document.body.textContent).toContain("Main Page");
		expect(document.body.textContent).not.toContain("Default Not Found");
		expect(getInput()?.value).toBe("kept after fallback");
	});
});
