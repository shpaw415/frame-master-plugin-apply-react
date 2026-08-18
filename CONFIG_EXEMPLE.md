```typescript
import type { FrameMasterConfig } from "frame-master/server/types";
import ApplyReact from "frame-master-plugin-apply-react/plugin";
import ReactToHtml from "frame-master-plugin-react-to-html";

export default {
  HTTPServer: { port: 3000 },
  plugins: [
    ReactToHtml({
      outDir: ".frame-master/build",
      srcDir: "src/pages",
      shellPath: "src/shell.tsx",
    }),
    ApplyReact({
      style: "nextjs",
      route: "src/pages",
      clientShellPath: "src/client-shell.tsx",
      enableHMR: true,
      enableFastRefresh: true,
      HMROptions: {
        websocket: "auto",
      },
    }),
  ],
} satisfies FrameMasterConfig;
```
