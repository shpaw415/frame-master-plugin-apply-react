import type { FrameMasterPlugin } from "frame-master/plugin/types";
import type { FrameMasterConfig } from "frame-master/server/types";
import ApplyReact from "frame-master-plugin-apply-react/plugin";
import ServeFromBuild from "frame-master-plugin-serve-from-build";

export default {
	HTTPServer: {
		port: process.env.PORT ?? 3000,
	},
	pluginsOptions: {
		entrypoints: ["index.html"],
		// serve-from-build still peers frame-master ^3.x during the staged v4 migration
		skipRequirementsCheck: true,
	},
	plugins: [
		ApplyReact({
			clientShellPath: "./src/client-shell.tsx",
			route: "src/pages",
			style: "nextjs",
			enableHMR: true,
			enableFastRefresh: true,
			HMROptions: {
				// auto: wss on https (dev.webcreas.com tunnel), ws on http localhost
				websocket: "auto",
			},
		}) as FrameMasterPlugin,
		ServeFromBuild({
			buildDir: ".frame-master/build",
			plainURLPaths: ["index.html"],
		}),
		{
			name: "builder",
			version: "0.1.0",
			serverReady: async ({ builder }) => {
				await builder.build();
			},
			"build": {
				afterBuild: async () => {
					console.log("Build completed!");
				}
			}
		},
	],
} satisfies FrameMasterConfig;
