import type _ROUTES_ from "@apply-react/client-routes.ts";
import { join } from "frame-master/utils";
import type { JSX } from "react";

export const LayoutCache = new Map<
	string,
	(props: { children: JSX.Element }) => JSX.Element
>();

export async function getRelatedLayoutFromPathname(
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

	const relatedLayouts: Array<
		(props: { children: JSX.Element }) => JSX.Element
	> = [];

	if (layouts["/layout"]) {
		if (!LayoutCache.has("/layout")) {
			LayoutCache.set("/layout", await layouts["/layout"]?.());
		}
		relatedLayouts.push(
			LayoutCache.get("/layout") as (props: {
				children: JSX.Element;
			}) => JSX.Element,
		);
	}

	if (paths.length === 0) return relatedLayouts;

	const currentPathname = "";
	for await (const path of paths) {
		const testPathname = join(currentPathname, path);
		const layoutPathToTest = `/${join(testPathname, "layout")}`;
		if (typeof layouts[layoutPathToTest] === "undefined") continue;
		if (!LayoutCache.has(layoutPathToTest)) {
			LayoutCache.set(layoutPathToTest, await layouts[layoutPathToTest]?.());
		}
		relatedLayouts.push(
			LayoutCache.get(layoutPathToTest) as (props: {
				children: JSX.Element;
			}) => JSX.Element,
		);
	}

	return relatedLayouts;
}

export function WrapWithLayouts({
	children,
	layouts,
}: {
	children: JSX.Element;
	layouts: Array<(props: { children: JSX.Element }) => JSX.Element>;
}) {
	return layouts.reduceRight(
		(acc, Layout, _i) => <Layout key={Layout.toString()}>{acc}</Layout>,
		children,
	);
}
