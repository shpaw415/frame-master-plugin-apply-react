import type _ROUTES_ from "@apply-react/client-routes.ts";
import { join } from "frame-master/utils";
import type { JSX } from "react";

export type LayoutComponent = (props: { children: JSX.Element }) => JSX.Element;

export type LayoutEntry = {
	id: string;
	Layout: LayoutComponent;
};

export const LayoutCache = new Map<string, LayoutComponent>();

async function getLayoutComponent(
	layouts: typeof _ROUTES_,
	layoutPath: string,
	options?: { bypassCache?: boolean },
) {
	if (!options?.bypassCache && LayoutCache.has(layoutPath)) {
		return LayoutCache.get(layoutPath) as LayoutComponent;
	}

	const Layout = await layouts[layoutPath]?.();
	if (!Layout) {
		throw new Error(`Missing layout component for ${layoutPath}`);
	}
	LayoutCache.set(layoutPath, Layout);
	return Layout;
}

/** Drop cached layout components (call on HMR shell updates). */
export function invalidateLayoutCache(layoutPath?: string) {
	if (layoutPath) LayoutCache.delete(layoutPath);
	else LayoutCache.clear();
}

export async function getRelatedLayoutEntriesFromPathname(
	pn: string,
	routes: typeof _ROUTES_,
) {
	const { router } = await import("./router");
	const pathname = router.match(pn)?.name as string;
	const paths = pathname ? pathname.split("/").filter(Boolean) : [];
	const layouts = Object.assign(
		{},
		...Object.entries(routes)
			.filter(([pathname, _layout]) => pathname.endsWith("layout"))
			.map(([k, v]) => ({ [k]: v })),
	) as typeof _ROUTES_;

	const relatedLayouts: LayoutEntry[] = [];

	if (layouts["/layout"]) {
		relatedLayouts.push({
			id: "/layout",
			Layout: await getLayoutComponent(layouts, "/layout"),
		});
	}

	if (paths.length === 0) return relatedLayouts;

	let currentPathname = "";
	for await (const path of paths) {
		currentPathname = join(currentPathname, path);
		const layoutPathToTest = `/${join(currentPathname, "layout")}`;
		if (typeof layouts[layoutPathToTest] === "undefined") continue;
		relatedLayouts.push({
			id: layoutPathToTest,
			Layout: await getLayoutComponent(layouts, layoutPathToTest),
		});
	}

	return relatedLayouts;
}

export async function getRelatedLayoutFromPathname(
	pn: string,
	routes: typeof _ROUTES_,
) {
	return (await getRelatedLayoutEntriesFromPathname(pn, routes)).map(
		({ Layout }) => Layout,
	);
}

function isLayoutEntry(
	layout: LayoutComponent | LayoutEntry,
): layout is LayoutEntry {
	return typeof layout === "object" && layout !== null && "Layout" in layout;
}

export function WrapWithLayouts({
	children,
	layouts,
}: {
	children: JSX.Element;
	layouts: Array<LayoutComponent | LayoutEntry>;
}) {
	const normalizedLayouts = layouts.map((layout, index) =>
		isLayoutEntry(layout)
			? layout
			: {
					id: `layout-${index}`,
					Layout: layout,
				},
	);

	return normalizedLayouts.reduceRight(
		(acc, { Layout, id }) => <Layout key={id}>{acc}</Layout>,
		children,
	);
}
