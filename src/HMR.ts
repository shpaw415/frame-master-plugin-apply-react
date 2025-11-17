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
  onRoutesUpdate: (routes: typeof globalThis._ROUTES_) => Promise<void> | void
) {
  initializeWebSocket();
  const handleMessage = async (event: MessageEvent) => {
    const message = event.data as "update-routes";
    switch (message) {
      case "update-routes":
        const newRoutes = (
          await import(`/routes/client:routes.js?t=${Date.now()}`)
        ).default;
        await onRoutesUpdate(newRoutes);
        break;
    }
  };

  ws.addEventListener("message", handleMessage);
  return () => {
    ws.removeEventListener("message", handleMessage);
  };
}
