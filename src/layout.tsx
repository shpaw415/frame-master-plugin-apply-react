import type _ROUTES_ from "@apply-react/client-routes.ts";
import { join } from "frame-master/utils";
import type { JSX } from "react";

export function getRelatedLayoutFromPathname(
	pathname: string,
	routes: typeof _ROUTES_,
) {
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

	if (layouts["/layout"]) relatedLayouts.push(layouts["/layout"]);

	if (paths.length === 0) return relatedLayouts;

	const currentPathname = "";
	for (const path of paths) {
		const testPathname = join(currentPathname, path);
		const layoutPathToTest = `/${join(testPathname, "layout")}`;
		if (typeof layouts[layoutPathToTest] === "undefined") continue;
		relatedLayouts.push(layouts[layoutPathToTest]);
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
	return layouts.reduceRight((acc, Layout, _i) => {
		return <Layout key={Layout.toString()}>{acc}</Layout>;
	}, children);
}
