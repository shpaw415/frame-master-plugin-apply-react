const props = {
	style: "nextjs" as const,
	route: "src/pages",
	enableHMR: false,
	hydration: "hydrate" as const,
	hmr: { preserveState: true, moduleGraph: "bundled" as const },
};
export default props;
