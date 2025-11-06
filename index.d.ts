/// <reference types="react" />

declare module "client:shell" {
  import type { JSX } from "react";
  export default function Wrapper(args: { children: JSX.Element }): JSX.Element;
}

declare module "client:routes" {
  import type { JSX } from "react";
  const routes: Record<string, () => JSX.Element>;
  export default routes;
}

declare global {
  var _ROUTES_: Record<string, () => JSX.Element>;
  var HMR_ENABLED: boolean;
}
export {};
