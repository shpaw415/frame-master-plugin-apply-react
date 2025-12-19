declare module "client-shell" {
  export default function Wrapper(args: {
    children: React.JSX.Element;
  }): React.JSX.Element;
}

declare module "client-routes" {
  const routes: Record<string, () => React.JSX.Element>;
  export default routes;
}

declare module "routes/client-routes" {
  const routes: Record<string, () => React.JSX.Element>;
  export default routes;
}
