// Ambient module declarations for client-side modules
declare module "client:shell" {
  import type { JSX } from "react";
  const Shell: (args: { children: JSX.Element }) => JSX.Element;
  export default Shell;
}

declare module "/routes/client:routes" {
  import type { JSX } from "react";
  const routes: Record<string, () => JSX.Element>;
  export default routes;
}

declare global {
  var HMR_ENABLED: boolean;
}
