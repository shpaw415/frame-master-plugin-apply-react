import type { FrameMasterPlugin } from "frame-master/plugin/types";
import type { FrameMasterConfig } from "frame-master/server/types";
import ApplyReact from "frame-master-plugin-apply-react/plugin";
import ServeFromBuild from "frame-master-plugin-serve-from-build";

export default {
	HTTPServer: {
		port: 3000,
	},
	pluginsOptions: {
		entrypoints: ["index.html"],
	},
	plugins: [
		ApplyReact({
			clientShellPath: "./src/client-shell.tsx",
			route: "src/pages",
			style: "nextjs",
			enableHMR: true,
		}) as FrameMasterPlugin,
		ServeFromBuild({
			buildDir: ".frame-master/build",
			plainURLPaths: ["index.html"],
		}),
		{
			name: "builder",
			version: "0.1.0",
			serverReady({ builder }) {
				builder.build();
			},
		},
	],
} satisfies FrameMasterConfig;
