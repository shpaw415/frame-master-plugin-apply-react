import type { JSX } from "react";

let ws: WebSocket;

type RouteUpdatePayload = {
	pathname: string;
	routeName: string;
	component: () => Promise<() => JSX.Element>;
};

type SetupHMRCallbacks = {
	onRoutesUpdate: (route: RouteUpdatePayload) => Promise<void> | void;
	onRouteBuildStarted?: (route: {
		pathname: string;
		routeName: string;
	}) => Promise<void> | void;
	onRouteBuildMissing?: (route: { pathname: string }) => Promise<void> | void;
};

function initializeWebSocket() {
	if (ws) return;
	ws = new WebSocket(`ws://${window.location.host}/_REACT_HMR/ws`);
}

/**
 * Initializes Hot Module Replacement for client-side route updates.
 *
 * @features
 * - Establishes WebSocket connection to the HMR server
 * - Automatically reloads routes when file changes are detected
 * - Updates global route registry without full page refresh
 * - Provides cleanup mechanism for proper resource management
 *
 * @param onRoutesUpdate - Callback invoked when routes are updated
 * @returns A cleanup function to remove the HMR listener
 */
export function setupHMR(
	callbacks:
		| SetupHMRCallbacks
		| ((route: RouteUpdatePayload) => Promise<void> | void),
) {
	initializeWebSocket();
	const {
		onRoutesUpdate,
		onRouteBuildStarted,
		onRouteBuildMissing,
	}: SetupHMRCallbacks =
		typeof callbacks === "function" ? { onRoutesUpdate: callbacks } : callbacks;
	const handleMessage = async (event: MessageEvent) => {
		const message = JSON.parse(event.data) as HMRMessage;
		switch (message.type) {
			case "update-routes":
				await onRoutesUpdate({
					pathname: message.pathname,
					routeName: message.routeName,
					component: () =>
						import(
							`/@apply-react/routes/${message.route}?t=${Date.now()}`
						).then((mod) => mod.default as () => JSX.Element),
				});
				break;
			case "route-build-started":
				await onRouteBuildStarted?.({
					pathname: message.pathname,
					routeName: message.routeName,
				});
				break;
			case "route-build-missing":
				await onRouteBuildMissing?.({ pathname: message.pathname });
				break;
			default:
				break;
		}
	};

	ws.addEventListener("message", handleMessage);
	return () => {
		ws.removeEventListener("message", handleMessage);
	};
}

export async function requestDevRouteBuild(pathname: string) {
	const response = await fetch(
		`/_REACT_HMR/build-route?pathname=${encodeURIComponent(pathname)}`,
		{
			headers: { accept: "application/json" },
		},
	);

	if (!response.ok && response.status !== 404) {
		throw new Error(`Failed to request dev route build for ${pathname}`);
	}

	return (await response.json()) as DevRouteBuildResponse;
}
