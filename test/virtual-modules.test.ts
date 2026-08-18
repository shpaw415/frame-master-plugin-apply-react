import { afterEach, expect, test } from "bun:test";
import {
	createPluginTestEnv,
	type PluginTestEnv,
	withTempDir,
} from "frame-master/testing";
import { peerDependencies } from "../package.json";
import applyReactPluginToHTML from "../src/index";

let env: PluginTestEnv | undefined;

afterEach(async () => {
	await env?.dispose();
	env = undefined;
});

const RUNTIME_BOOTSTRAPS = [
	"@apply-react/client-routes.ts",
	"@apply-react/client-hydrate.tsx",
	"@apply-react/client-shell.tsx",
	"@apply-react/HMR.ts",
	"@apply-react/react-refresh-runtime.ts",
	"@apply-react/HMR-enabled.ts",
	"@apply-react/fast-refresh-enabled.ts",
	"@apply-react/hmr-websocket-protocol.ts",
	"@apply-react/development-mode.ts",
	"@apply-react/props.ts",
	"@apply-react/404.tsx",
	"@apply-react/loading.tsx",
] as const;

function createPlugin() {
	return applyReactPluginToHTML({
		style: "nextjs",
		route: "test/src/pages",
		enableHMR: false,
		enableFastRefresh: false,
	});
}

test("derives requirement.frameMasterVersion from the package peer", () => {
	const plugin = createPlugin();
	expect(plugin.requirement?.frameMasterVersion).toBe(
		peerDependencies["frame-master"],
	);
	expect(plugin.requirement?.frameMasterVersion).toBe("^4.0.0-0");
});

test("loads apply-react virtual bootstraps through the v4 registry", async () => {
	await withTempDir(async (dir) => {
		const plugin = createPlugin();
		env = await createPluginTestEnv({
			cwd: dir,
			plugins: [plugin],
			startServer: false,
			runCreateContext: false,
			runServerStart: false,
		});

		const registry = env.pluginLoader.getVirtualModuleRegistry();
		for (const specifier of RUNTIME_BOOTSTRAPS) {
			const module = registry.getModule(specifier);
			expect(module, specifier).toBeDefined();
			expect(module?.injectRuntime).toBe(true);
			expect(module?.loader).toBe(specifier.endsWith(".tsx") ? "tsx" : "ts");
		}

		const clientRoutes = registry.getModule("@apply-react/client-routes.ts");
		expect(clientRoutes).toBeDefined();
		expect(typeof clientRoutes?.contents).toBe("function");
		const generateClientRoutes = clientRoutes?.contents;
		expect(typeof generateClientRoutes).toBe("function");
		if (typeof generateClientRoutes !== "function") return;
		const generated = generateClientRoutes();
		expect(generated).toContain('"/":');
		expect(generated).toContain("index.tsx");

		const developmentMode = registry.getModule(
			"@apply-react/development-mode.ts",
		);
		expect(developmentMode?.contents).toContain("const IS_DEVELOPMENT");

		const runtimePlugin = registry.createPlugin(true);
		expect(runtimePlugin).not.toBeNull();
		if (!runtimePlugin) return;
		await Bun.plugin(runtimePlugin);

		const imported = await import("@apply-react/development-mode.ts");
		expect(imported.default).toBe(true);
	});
});

test("declares virtual bootstraps without BuildConfig.files", () => {
	const plugin = createPlugin();
	const buildConfig = plugin.build?.buildConfig;
	expect(typeof buildConfig).toBe("function");
	const config =
		typeof buildConfig === "function" ? buildConfig() : buildConfig;
	expect(config?.files).toBeUndefined();
	expect(config?.entrypoints).toContain("@apply-react/client-hydrate.tsx");
	expect(config?.entrypoints).toContain("@apply-react/client-routes.ts");
	expect(plugin.runtimePlugins ?? []).toBeEmpty();
});
