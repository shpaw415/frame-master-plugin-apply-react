// Minimal preload for integration tests — no happy-dom (it breaks Bun.serve routes).
(
	globalThis as typeof globalThis & {
		__APPLY_REACT_NATIVE_FETCH__?: typeof fetch;
		__APPLY_REACT_NATIVE_WEBSOCKET__?: typeof WebSocket;
	}
).__APPLY_REACT_NATIVE_FETCH__ = globalThis.fetch.bind(globalThis);
(
	globalThis as typeof globalThis & {
		__APPLY_REACT_NATIVE_WEBSOCKET__?: typeof WebSocket;
	}
).__APPLY_REACT_NATIVE_WEBSOCKET__ = globalThis.WebSocket;
