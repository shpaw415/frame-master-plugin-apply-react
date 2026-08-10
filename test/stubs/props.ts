import type { ApplyReactPluginOptions } from "../../src/options";

const props: ApplyReactPluginOptions = {
	style: "nextjs",
	route: "src/pages",
	enableHMR: false,
	hydration: "hydrate",
	hmr: { preserveState: true, moduleGraph: "bundled" },
};

export default props;
