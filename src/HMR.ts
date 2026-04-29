import type { JSX } from "react";

let ws: WebSocket;

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
	onRoutesUpdate: (route: {
		pathname: string;
		component: () => JSX.Element;
	}) => Promise<void> | void,
) {
	initializeWebSocket();
	const handleMessage = async (event: MessageEvent) => {
		const message = JSON.parse(event.data) as HMRMessage;
		let newRoutes: () => JSX.Element;
		switch (message.type) {
			case "update-routes":
				newRoutes = (
					await import(`/@apply-react/routes/${message.route}?t=${Date.now()}`)
				).default;
				await onRoutesUpdate({
					pathname: message.pathname,
					component: newRoutes,
				});
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
