declare module "@apply-react/client-shell.tsx" {
	export default function Wrapper(args: {
		children: React.JSX.Element;
	}): React.JSX.Element;
}

declare module "@apply-react/client-routes.ts" {
	const routes: Record<string, () => React.JSX.Element>;
	export default routes;
}

declare module "@apply-react/HMR-enabled.ts" {
	const HMR_ENABLED: boolean;
	export default HMR_ENABLED;
}
