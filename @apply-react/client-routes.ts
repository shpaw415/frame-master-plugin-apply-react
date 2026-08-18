import type { JSX } from "react";

const isTestMode = process.env.NODE_ENV === "test";

const routes: Record<
	string,
	() => Promise<(...args: never[]) => JSX.Element>
> = isTestMode
	? {
			"/": () => import("../test/src/pages/index").then((mod) => mod.default),
			"/layout": () =>
				import("../test/src/pages/layout").then((mod) => mod.default),
			"/loading": () => import("./loading").then((mod) => mod.default),
			"/404": () => import("./404").then((mod) => mod.default),
			"/dynamic/[id]": () =>
				import("../test/src/pages/dynamic/[id]").then((mod) => mod.default),
			"/profile": () =>
				import("../test/src/pages/profile/index").then((mod) => mod.default),
			"/sub": () => import("../test/src/pages/sub/index").then((mod) => mod.default),
			"/sub/loading": () => import("./loading").then((mod) => mod.default),
			"/sub/404": () =>
				import("../test/src/pages/sub/404").then((mod) => mod.default),
			"/sub/[id]": () =>
				import("../test/src/pages/sub/[id]").then((mod) => mod.default),
		}
	: {};

export default routes;
