// happy-dom is for unit/router tests. Integration tests run in a separate
// process without this preload (see package.json test:integration).
import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeFetch = globalThis.fetch.bind(globalThis);
const nativeWebSocket = globalThis.WebSocket;

(
	globalThis as typeof globalThis & {
		__APPLY_REACT_NATIVE_FETCH__?: typeof fetch;
		__APPLY_REACT_NATIVE_WEBSOCKET__?: typeof WebSocket;
	}
).__APPLY_REACT_NATIVE_FETCH__ = nativeFetch;
(
	globalThis as typeof globalThis & {
		__APPLY_REACT_NATIVE_WEBSOCKET__?: typeof WebSocket;
	}
).__APPLY_REACT_NATIVE_WEBSOCKET__ = nativeWebSocket;

GlobalRegistrator.register({
	url: "http://localhost/",
	width: 1280,
	height: 720,
});

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

if (!globalThis.requestAnimationFrame) {
	globalThis.requestAnimationFrame = (callback) =>
		window.setTimeout(() => callback(performance.now()), 0);
}

if (!globalThis.cancelAnimationFrame) {
	globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
}

if (!window.scrollTo) {
	window.scrollTo = () => {};
}

if (!Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => {};
}
