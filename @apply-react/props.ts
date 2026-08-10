/**
 * Placeholder for the virtual `@apply-react/props.ts` module.
 * Overridden at build time with the live ApplyReactPluginOptions JSON.
 * Kept on disk so the specifier resolves for tooling, tests, and runtime imports.
 */
import type { ApplyReactPluginOptions } from "../src/options";

const props: ApplyReactPluginOptions = {
	style: "nextjs",
	route: "src/pages",
	enableHMR: false,
	hydration: "hydrate",
};

export default props;
