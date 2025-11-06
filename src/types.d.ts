import type { JSX } from "react";

declare module "client:shell" {
  export default function Wrapper(args: { children: JSX.Element }): JSX.Element;
}

declare module "client:routes" {
  const routes: Record<string, () => JSX.Element>;
  export default routes;
}

declare global {
  var _ROUTES_: Record<string, () => JSX.Element>;
}

export {};