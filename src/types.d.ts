declare module "@apply-react/client-shell.tsx" {
	export default function Wrapper(args: {
		children: React.JSX.Element;
	}): React.JSX.Element;
}

declare module "@apply-react/client-routes.ts" {
	const routes: Record<string, () => Promise<() => React.JSX.Element>>;
	export default routes;
}

declare module "@apply-react/HMR-enabled.ts" {
	const HMR_ENABLED: boolean;
	export default HMR_ENABLED;
}

declare module "@apply-react/404.tsx" {
	export default function NotFound(): React.JSX.Element;
}

declare module "@apply-react/loading.tsx" {
	export default function Loading(): React.JSX.Element;
}

declare module "@apply-react/props.ts" {
	const ApplyReactPluginOptions: import("./options.ts").ApplyReactPluginOptions;
	export default ApplyReactPluginOptions;
}

declare type RouteUpdateMessage =
	import("./hmr/protocol.ts").RouteUpdateMessage;
declare type RouteBuildStartedMessage =
	import("./hmr/protocol.ts").RouteBuildStartedMessage;
declare type RouteBuildMissingMessage =
	import("./hmr/protocol.ts").RouteBuildMissingMessage;
declare type RouteBuildFailedMessage =
	import("./hmr/protocol.ts").RouteBuildFailedMessage;
declare type FullReloadMessage = import("./hmr/protocol.ts").FullReloadMessage;
declare type HMRMessage = import("./hmr/protocol.ts").HMRMessage;
declare type DevRouteBuildResponse =
	import("./hmr/protocol.ts").DevRouteBuildResponse;
