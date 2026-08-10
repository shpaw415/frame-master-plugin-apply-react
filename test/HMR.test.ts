import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	__resetHmrClientForTests,
	hmrWsUrl,
	parseHmrMessage,
	requestDevRouteBuild,
	setupHMR,
} from "../src/HMR";
import { HMR_PROTOCOL_VERSION } from "../src/hmr/protocol";

class FakeWebSocket {
	static instance: FakeWebSocket | null = null;
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = FakeWebSocket.CONNECTING;
	private listeners = new Map<string, Set<(event: Event) => void>>();

	constructor(public readonly url: string) {
		FakeWebSocket.instance = this;
		queueMicrotask(() => {
			this.readyState = FakeWebSocket.OPEN;
			this.emit("open", new Event("open"));
		});
	}

	addEventListener(type: string, listener: (event: Event) => void) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: Event) => void) {
		this.listeners.get(type)?.delete(listener);
	}

	send(_data: string) {}

	close() {
		this.readyState = FakeWebSocket.CLOSED;
		this.emit("close", new Event("close"));
	}

	emit(type: string, event: Event) {
		const listeners = this.listeners.get(type);
		if (!listeners) return;
		for (const listener of listeners) listener(event);
	}

	async emitMessage(message: unknown) {
		const event = {
			data: JSON.stringify(message),
		} as MessageEvent<string>;
		const listeners = this.listeners.get("message");
		if (!listeners) return;
		for (const listener of listeners) {
			await (listener as (e: MessageEvent<string>) => Promise<void>)(event);
		}
	}
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

describe("hmrWsUrl", () => {
	test("uses ws on http", () => {
		expect(hmrWsUrl("localhost:3000")).toContain("ws://");
	});
});

describe("parseHmrMessage", () => {
	test("parses update-routes and rejects garbage", () => {
		expect(parseHmrMessage("not-json")).toBeNull();
		expect(
			parseHmrMessage({
				type: "update-routes",
				route: "x.js",
				pathname: "/",
				routeName: "/",
				generation: 2,
			}),
		).toMatchObject({ type: "update-routes", generation: 2 });
	});
});

describe("setupHMR", () => {
	afterEach(() => {
		__resetHmrClientForTests();
		globalThis.WebSocket = originalWebSocket;
		FakeWebSocket.instance = null;
	});

	test("dispatches update and build lifecycle messages to callbacks", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

		const onRoutesUpdate = mock(async () => {});
		const onRouteBuildStarted = mock(async () => {});
		const onRouteBuildMissing = mock(async () => {});
		const onBuildFailed = mock(async () => {});

		const cleanup = setupHMR({
			onRoutesUpdate,
			onRouteBuildStarted,
			onRouteBuildMissing,
			onBuildFailed,
		});

		// allow open microtask
		await new Promise((r) => setTimeout(r, 0));

		const socket = FakeWebSocket.instance;
		expect(socket).not.toBeNull();
		expect(socket?.url).toBe("ws://localhost/_REACT_HMR/ws");

		await socket?.emitMessage({
			v: HMR_PROTOCOL_VERSION,
			generation: 1,
			type: "route-build-started",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
		});
		await socket?.emitMessage({
			v: HMR_PROTOCOL_VERSION,
			generation: 1,
			type: "update-routes",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			route: "dynamic/[id].js",
		});
		await socket?.emitMessage({
			v: HMR_PROTOCOL_VERSION,
			generation: 1,
			type: "route-build-missing",
			pathname: "/missing",
		});
		await socket?.emitMessage({
			v: HMR_PROTOCOL_VERSION,
			generation: 2,
			type: "build-failed",
			pathname: "/",
			error: { message: "boom" },
		});
		await socket?.emitMessage("not-json{{{");

		expect(onRouteBuildStarted).toHaveBeenCalledWith({
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			generation: 1,
		});
		expect(onRoutesUpdate).toHaveBeenCalledWith({
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			generation: 1,
			component: expect.any(Function),
		});
		expect(onRouteBuildMissing).toHaveBeenCalledWith({
			pathname: "/missing",
			generation: 1,
		});
		expect(onBuildFailed).toHaveBeenCalledWith({
			pathname: "/",
			routeName: undefined,
			generation: 2,
			error: { message: "boom" },
		});

		cleanup();
	});
});

describe("requestDevRouteBuild", () => {
	beforeEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("requests a dev build for a matched route pathname", async () => {
		const fetchMock = mock(
			async () =>
				new Response(
					JSON.stringify({
						status: "building",
						pathname: "/dynamic/123",
						routeName: "/dynamic/[id]",
						generation: 1,
					} satisfies DevRouteBuildResponse),
					{ status: 202, headers: { "content-type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await requestDevRouteBuild("/dynamic/123");

		expect(fetchMock).toHaveBeenCalledWith(
			"/_REACT_HMR/build-route?pathname=%2Fdynamic%2F123",
			expect.objectContaining({
				headers: { accept: "application/json" },
			}),
		);
		expect(result).toEqual({
			status: "building",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			generation: 1,
		});
	});

	test("returns the missing response when the dev server reports 404", async () => {
		const fetchMock = mock(
			async () =>
				new Response(
					JSON.stringify({
						status: "missing",
						pathname: "/missing",
						generation: 0,
					} satisfies DevRouteBuildResponse),
					{ status: 404, headers: { "content-type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await requestDevRouteBuild("/missing");

		expect(result).toEqual({
			status: "missing",
			pathname: "/missing",
			generation: 0,
		});
	});
});

// local type alias for test
type DevRouteBuildResponse = import("../src/hmr/protocol").DevRouteBuildResponse;
