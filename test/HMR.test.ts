import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// RouterHMR (and other suites) may leave module mocks active; isolate this file.
mock.restore();

const {
	__resetHmrSocketForTests,
	requestDevRouteBuild,
	resolveClientHmrWebsocketScheme,
	setupHMR,
} = await import(`../src/HMR?hmr-unit=${Date.now()}`);

class FakeWebSocket {
	static instance: FakeWebSocket | null = null;
	static instancesCreated = 0;
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;

	readyState = FakeWebSocket.OPEN;

	private listeners = new Map<
		string,
		Set<(event: MessageEvent<string>) => Promise<void> | void>
	>();

	constructor(public readonly url: string) {
		FakeWebSocket.instance = this;
		FakeWebSocket.instancesCreated += 1;
	}

	addEventListener(
		type: string,
		listener: (event: MessageEvent<string>) => Promise<void> | void,
	) {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(
		type: string,
		listener: (event: MessageEvent<string>) => Promise<void> | void,
	) {
		this.listeners.get(type)?.delete(listener);
	}

	async emit(message: HMRMessage) {
		await this.emitRaw(JSON.stringify(message));
	}

	async emitRaw(payload: string) {
		const listeners = this.listeners.get("message");
		if (!listeners) return;

		for (const listener of listeners) {
			await listener({ data: payload } as MessageEvent<string>);
		}
	}
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

describe("setupHMR", () => {
	beforeEach(() => {
		__resetHmrSocketForTests();
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		FakeWebSocket.instance = null;
		FakeWebSocket.instancesCreated = 0;
	});

	afterEach(() => {
		if (FakeWebSocket.instance) {
			FakeWebSocket.instance.readyState = FakeWebSocket.CLOSED;
		}
		__resetHmrSocketForTests();
		globalThis.WebSocket = originalWebSocket;
		FakeWebSocket.instance = null;
		FakeWebSocket.instancesCreated = 0;
	});

	test("dispatches update and build lifecycle messages to callbacks", async () => {
		const onRoutesUpdate = mock(async () => {});
		const onRouteBuildStarted = mock(async () => {});
		const onRouteBuildMissing = mock(async () => {});

		const cleanup = setupHMR({
			onRoutesUpdate,
			onRouteBuildStarted,
			onRouteBuildMissing,
		});

		const socket = FakeWebSocket.instance;
		expect(socket).not.toBeNull();
		expect(socket?.url).toBe("ws://localhost/_REACT_HMR/ws");

		expect(resolveClientHmrWebsocketScheme("ws", "https:")).toBe("ws");
		expect(resolveClientHmrWebsocketScheme("wss", "http:")).toBe("wss");
		expect(resolveClientHmrWebsocketScheme("auto", "https:")).toBe("wss");
		expect(resolveClientHmrWebsocketScheme("auto", "http:")).toBe("ws");

		await socket?.emit({
			type: "route-build-started",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
		});
		await socket?.emit({
			type: "update-routes",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			route: "dynamic/[id].js",
		});
		await socket?.emit({
			type: "route-build-missing",
			pathname: "/missing",
		});

		expect(onRouteBuildStarted).toHaveBeenCalledWith({
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
		});
		expect(onRoutesUpdate).toHaveBeenCalledWith({
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			component: expect.any(Function),
		});
		expect(onRouteBuildMissing).toHaveBeenCalledWith({
			pathname: "/missing",
		});

		cleanup();
	});

	test("ignores malformed websocket payloads and keeps the listener alive", async () => {
		const onRoutesUpdate = mock(async () => {});
		const cleanup = setupHMR({ onRoutesUpdate });
		const socket = FakeWebSocket.instance;

		await socket?.emitRaw("not-json");
		await socket?.emit({
			type: "update-routes",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
			route: "dynamic/[id].js",
		});

		expect(onRoutesUpdate).toHaveBeenCalledTimes(1);
		cleanup();
	});

	test("isolates callback errors so later messages still process", async () => {
		const onRouteBuildStarted = mock(async () => {
			throw new Error("failing callback");
		});
		const onRouteBuildMissing = mock(async () => {});
		const cleanup = setupHMR({
			onRouteBuildStarted,
			onRouteBuildMissing,
			onRoutesUpdate: async () => {},
		});
		const socket = FakeWebSocket.instance;

		await socket?.emit({
			type: "route-build-started",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
		});
		await socket?.emit({
			type: "route-build-missing",
			pathname: "/missing",
		});

		expect(onRouteBuildStarted).toHaveBeenCalledTimes(1);
		expect(onRouteBuildMissing).toHaveBeenCalledTimes(1);
		cleanup();
	});

	test("reuses an open websocket across setup calls", async () => {
		const cleanupA = setupHMR({ onRoutesUpdate: async () => {} });
		const cleanupB = setupHMR({ onRoutesUpdate: async () => {} });

		expect(FakeWebSocket.instancesCreated).toBe(1);
		cleanupA();
		cleanupB();
	});

	test("re-initializes websocket when previous instance is closed", async () => {
		const cleanupA = setupHMR({ onRoutesUpdate: async () => {} });
		const firstSocket = FakeWebSocket.instance;
		expect(firstSocket).not.toBeNull();
		if (!firstSocket) throw new Error("Expected first socket instance");

		firstSocket.readyState = FakeWebSocket.CLOSED;
		const cleanupB = setupHMR({ onRoutesUpdate: async () => {} });
		const secondSocket = FakeWebSocket.instance;

		expect(secondSocket).not.toBeNull();
		expect(secondSocket).not.toBe(firstSocket);
		expect(FakeWebSocket.instancesCreated).toBe(2);

		cleanupA();
		cleanupB();
	});

	test("ignores unknown message types", async () => {
		const onRoutesUpdate = mock(async () => {});
		const onRouteBuildStarted = mock(async () => {});
		const onRouteBuildMissing = mock(async () => {});
		const cleanup = setupHMR({
			onRoutesUpdate,
			onRouteBuildStarted,
			onRouteBuildMissing,
		});

		await FakeWebSocket.instance?.emitRaw(
			JSON.stringify({ type: "unknown-event", pathname: "/" }),
		);

		expect(onRoutesUpdate).toHaveBeenCalledTimes(0);
		expect(onRouteBuildStarted).toHaveBeenCalledTimes(0);
		expect(onRouteBuildMissing).toHaveBeenCalledTimes(0);
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
					} satisfies DevRouteBuildResponse),
					{ status: 202, headers: { "content-type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await requestDevRouteBuild("/dynamic/123");

		expect(fetchMock).toHaveBeenCalledWith(
			"/_REACT_HMR/build-route?pathname=%2Fdynamic%2F123",
			{
				headers: { accept: "application/json" },
			},
		);
		expect(result).toEqual({
			status: "building",
			pathname: "/dynamic/123",
			routeName: "/dynamic/[id]",
		});
	});

	test("returns the missing response when the dev server reports 404", async () => {
		const fetchMock = mock(
			async () =>
				new Response(
					JSON.stringify({
						status: "missing",
						pathname: "/missing",
					} satisfies DevRouteBuildResponse),
					{ status: 404, headers: { "content-type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await requestDevRouteBuild("/missing");

		expect(result).toEqual({
			status: "missing",
			pathname: "/missing",
		});
	});

	test("throws when the dev server reports a non-404 failure", async () => {
		const fetchMock = mock(
			async () =>
				new Response(JSON.stringify({ error: "boom" }), {
					status: 500,
					headers: { "content-type": "application/json" },
				}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		expect(requestDevRouteBuild("/broken")).rejects.toThrow(
			"Failed to request dev route build for /broken",
		);
	});
});
