import type { FrameMasterConfig } from "frame-master/server/types";
import ServeFromBuild from "frame-master-plugin-serve-from-build";
import ApplyReact from "./src";

const indexContent = await Bun.file("test/src/index.html").text();

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
			serverReady: async ({ builder }) => {
				await builder.build();
			},
			build: {
				buildConfig: {
					plugins: [
						{
							name: "add-index-html",
							setup(build) {
								build.onResolve({ filter: /\.html$/ }, (args) => {
									return {
										path: args.path,
										namespace: "html",
									};
								});
								build.onLoad({ filter: /\.html$/, namespace: "html" }, () => {
									return {
										contents: indexContent,
										loader: "html",
									};
								});
							},
						},
					],
				},
			},
		},
	],
} satisfies FrameMasterConfig;
