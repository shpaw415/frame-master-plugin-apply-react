import type { FrameMasterConfig } from "frame-master/server/types";
import ApplyReact from "./src";
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
			clientShellPath: "test/src/client-shell.tsx",
			route: "test/src/pages",
			style: "nextjs",
			hydration: "render",
			fallbacks: {
				defaultNotFoundComponentPath: "test/src/fallbacks/404.tsx",
			},
		}),
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
