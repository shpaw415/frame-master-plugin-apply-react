import type { FrameMasterConfig } from "frame-master/server/types";
import ReactToHtml from "frame-master-plugin-react-to-html";
import ApplyReact from "../src";
import type { FrameMasterPlugin } from "frame-master/plugin";

export default {
  HTTPServer: {
    port: 3000,
  },
  plugins: [
    ReactToHtml({
      outDir: ".frame-master/build",
      srcDir: "src/pages",
      shellPath: "src/shell.tsx",
    }),
    ApplyReact({
      route: "src/pages",
      style: "nextjs",
      clientShellPath: "src/client.tsx",
    }) as FrameMasterPlugin,
    {
      name: "custom-plugin",
      version: "1.0.0",
      build: {
        buildConfig: {
          root: ".",
        },
      },
    },
  ],
} satisfies FrameMasterConfig;
