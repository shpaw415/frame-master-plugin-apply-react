import { GlobalRegistrator } from "@happy-dom/global-registrator";

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
