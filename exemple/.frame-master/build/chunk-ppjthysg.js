// ../src/HMR.ts
var ws;
function initializeWebSocket() {
  if (ws)
    return;
  ws = new WebSocket(`ws://${window.location.host}/_REACT_HMR/ws`);
}
function setupHMR(onRoutesUpdate) {
  initializeWebSocket();
  const handleMessage = async (event) => {
    const message = event.data;
    let newRoutes;
    switch (message) {
      case "update-routes":
        newRoutes = (await import(`/@apply-react/client-routes.js?t=${Date.now()}`)).default;
        await onRoutesUpdate(newRoutes);
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

export { setupHMR };

//# debugId=492339F7D326B52064756E2164756E21
//# sourceMappingURL=./chunk-ppjthysg.js.map
