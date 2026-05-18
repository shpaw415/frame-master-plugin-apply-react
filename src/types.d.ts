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
	const ApplyReactPluginOptions: import("./index.ts").ApplyReactPluginOptions;
	export default ApplyReactPluginOptions;
}

declare type RouteUpdateMessage = {
	type: "update-routes";
	route: string;
	pathname: string;
	routeName: string;
};

declare type RouteBuildStartedMessage = {
	type: "route-build-started";
	pathname: string;
	routeName: string;
};

declare type RouteBuildMissingMessage = {
	type: "route-build-missing";
	pathname: string;
};

declare type HMRMessage =
	| RouteUpdateMessage
	| RouteBuildStartedMessage
	| RouteBuildMissingMessage;

declare type DevRouteBuildResponse =
	| {
			status: "building";
			pathname: string;
			routeName: string;
	  }
	| {
			status: "missing";
			pathname: string;
	  };
