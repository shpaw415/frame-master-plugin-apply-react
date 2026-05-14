import type { JSX } from "react";

const routes: Record<string, () => Promise<() => JSX.Element>> = {
	"/": () => import("../src/pages/index").then((mod) => mod.default),
	"/layout": () => import("../src/pages/layout").then((mod) => mod.default),
	"/loading": () => import("./loading").then((mod) => mod.default),
	"/404": () => import("./404").then((mod) => mod.default),
	"/dynamic/[id]": () =>
		import("../src/pages/dynamic/[id]").then((mod) => mod.default),
	"/profile": () =>
		import("../src/pages/profile/index").then((mod) => mod.default),
	"/sub": () => import("../src/pages/sub/index").then((mod) => mod.default),
	"/sub/loading": () => import("./loading").then((mod) => mod.default),
	"/sub/404": () => import("../src/pages/sub/404").then((mod) => mod.default),
	"/sub/[id]": () => import("../src/pages/sub/[id]").then((mod) => mod.default),
};
export default routes;
