import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { requestDevRouteBuild, setupHMR } from "../src/HMR";

class FakeWebSocket {
	static instance: FakeWebSocket | null = null;

	private listeners = new Map<
		string,
		Set<(event: MessageEvent<string>) => Promise<void> | void>
	>();

	constructor(public readonly url: string) {
		FakeWebSocket.instance = this;
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
		const listeners = this.listeners.get("message");
		if (!listeners) return;

		for (const listener of listeners) {
			await listener({ data: JSON.stringify(message) } as MessageEvent<string>);
		}
	}
}

const originalWebSocket = globalThis.WebSocket;
const originalFetch = globalThis.fetch;

describe("setupHMR", () => {
	afterEach(() => {
		globalThis.WebSocket = originalWebSocket;
		FakeWebSocket.instance = null;
	});

	test("dispatches update and build lifecycle messages to callbacks", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

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
});
