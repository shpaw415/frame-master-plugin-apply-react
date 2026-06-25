import type { JSX } from "react";

let ws: WebSocket | undefined;

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
	if (
		ws &&
		ws.readyState !== WebSocket.CLOSED &&
		ws.readyState !== WebSocket.CLOSING
	) {
		return;
	}
	ws = new WebSocket(`ws://${window.location.host}/_REACT_HMR/ws`);
}

function isRouteBuildStartedMessage(
	message: unknown,
): message is RouteBuildStartedMessage {
	return (
		typeof message === "object" &&
		message !== null &&
		(message as RouteBuildStartedMessage).type === "route-build-started" &&
		typeof (message as RouteBuildStartedMessage).pathname === "string" &&
		typeof (message as RouteBuildStartedMessage).routeName === "string"
	);
}

function isRouteBuildMissingMessage(
	message: unknown,
): message is RouteBuildMissingMessage {
	return (
		typeof message === "object" &&
		message !== null &&
		(message as RouteBuildMissingMessage).type === "route-build-missing" &&
		typeof (message as RouteBuildMissingMessage).pathname === "string"
	);
}

function isRouteUpdateMessage(message: unknown): message is RouteUpdateMessage {
	return (
		typeof message === "object" &&
		message !== null &&
		(message as RouteUpdateMessage).type === "update-routes" &&
		typeof (message as RouteUpdateMessage).pathname === "string" &&
		typeof (message as RouteUpdateMessage).routeName === "string" &&
		typeof (message as RouteUpdateMessage).route === "string"
	);
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
		let message: unknown;
		try {
			message = JSON.parse(event.data as string);
		} catch {
			console.warn("[Apply-React HMR] Received malformed websocket payload");
			return;
		}

		try {
			if (isRouteUpdateMessage(message)) {
				await onRoutesUpdate({
					pathname: message.pathname,
					routeName: message.routeName,
					component: () =>
						import(
							`/@apply-react/routes/${message.route}?t=${Date.now()}`
						).then((mod) => mod.default as () => JSX.Element),
				});
				return;
			}

			if (isRouteBuildStartedMessage(message)) {
				await onRouteBuildStarted?.({
					pathname: message.pathname,
					routeName: message.routeName,
				});
				return;
			}

			if (isRouteBuildMissingMessage(message)) {
				await onRouteBuildMissing?.({ pathname: message.pathname });
			}
		} catch (error) {
			console.error("[Apply-React HMR] Callback handling failed", error);
		}
	};

	ws?.addEventListener("message", handleMessage);
	return () => {
		ws?.removeEventListener("message", handleMessage);
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
