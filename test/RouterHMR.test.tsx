import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import routes from "@apply-react/client-routes.ts";
import type { JSX } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	getRelatedLayoutEntriesFromPathname,
	LayoutCache,
} from "../src/layout";
import HomePage from "./src/pages/index";

type RouteUpdate = {
	pathname: string;
	routeName: string;
	component: () => Promise<() => JSX.Element>;
};

let onRoutesUpdate: ((route: RouteUpdate) => Promise<void> | void) | undefined;

const hmrEnabledModule = import.meta.resolve("@apply-react/HMR-enabled.ts");
const fastRefreshModule = import.meta.resolve(
	"@apply-react/fast-refresh-enabled.ts",
);
const hmrModule = import.meta.resolve("../src/HMR.ts");

mock.module(hmrModule, () => ({
	requestDevRouteBuild: async () => ({ status: "missing", pathname: "/" }),
	setupHMR: ({
		onRoutesUpdate: callback,
	}: {
		onRoutesUpdate: typeof onRoutesUpdate;
	}) => {
		onRoutesUpdate = callback;
		return () => {
			onRoutesUpdate = undefined;
		};
	},
}));

mock.module(hmrEnabledModule, () => ({
	default: true,
}));

mock.module(fastRefreshModule, () => ({
	default: true,
}));

const { RouterHost, setInitialRouteSnapshot } = await import(
	`../src/router?router-hmr-test=${Date.now()}`
);

function flushNavigation() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function getInput() {
	return document.querySelector(
		'input[aria-label="layout-state"]',
	) as HTMLInputElement | null;
}

function setInputValue(input: HTMLInputElement, value: string) {
	const valueSetter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	if (!valueSetter) throw new Error("Missing HTMLInputElement value setter");

	valueSetter.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("RouterHost HMR", () => {
	let root: Root | undefined;
	let container: HTMLDivElement;
	let routeChangeCount: number;

	afterAll(() => {
		mock.restore();
	});

	beforeEach(async () => {
		LayoutCache.clear();
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
					}}
				>
					<HomePage />
				</RouterHost>,
			);
			await flushNavigation();
		});
	});

	afterEach(async () => {
		if (root) {
			await act(async () => {
				root?.unmount();
				await flushNavigation();
			});
		}
		LayoutCache.clear();
		setInitialRouteSnapshot(null);
		document.body.innerHTML = "";
	});

	test("keeps the active layout mounted for an active-route hot update", async () => {
		const input = getInput();
		expect(input).not.toBeNull();
		if (!input) throw new Error("Missing shared layout input");

		await act(async () => {
			setInputValue(input, "kept during HMR");
			await flushNavigation();
		});

		let componentLoads = 0;
		const hotUpdate = onRoutesUpdate;
		expect(hotUpdate).toBeDefined();
		if (!hotUpdate) throw new Error("Missing HMR route update callback");

		await act(async () => {
			await hotUpdate({
				pathname: "/",
				routeName: "/",
				component: async () => {
					componentLoads += 1;
					return HomePage;
				},
			});
			await flushNavigation();
		});

		expect(componentLoads).toBe(1);
		expect(getInput()?.value).toBe("kept during HMR");
		expect(routeChangeCount).toBe(0);
	});
});
