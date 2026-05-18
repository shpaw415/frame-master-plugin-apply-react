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

const describeRouterHost = describe;

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

function setInputValue(input: HTMLInputElement, value: string) {
	const valueSetter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;

	if (!valueSetter) {
		throw new Error("Missing HTMLInputElement value setter");
	}

	valueSetter.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describeRouterHost("RouterHost shared layouts", () => {
	let root: Root | undefined;
	let container: HTMLDivElement;
	let routeChangeCount: number;

	beforeEach(async () => {
		LayoutCache.clear();
		setInitialRouteSnapshot(null);
		routeChangeCount = 0;
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
				<RouterHost
					onRouteChange={() => {
						routeChangeCount += 1;
						return Promise.resolve();
					}}
				>
					<HomePage />
				</RouterHost>,
			);
			await flushNavigation();
		});
	});

	afterEach(async () => {
		const mountedRoot = root;
		if (!mountedRoot) return;

		await act(async () => {
			mountedRoot.unmount();
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
			setInputValue(input, "kept across navigation");
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
			setInputValue(input, "kept after fallback");
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

	test("does not re-navigate when clicking a link to the current location", async () => {
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

		expect(routeChangeCount).toBe(0);
		expect(document.body.textContent).toContain("Main Page");
		expect(document.body.textContent).not.toContain("Default Loading");
		expect(window.location.pathname).toBe("/");
	});
});
