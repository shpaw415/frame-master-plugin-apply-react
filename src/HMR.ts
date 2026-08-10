import type { JSX } from "react";
import {
	type DevRouteBuildResponse,
	type HMRServerMessage,
	hmrWsUrl,
	parseHmrMessage,
	HMR_PROTOCOL_VERSION,
} from "./hmr/protocol";

export type { DevRouteBuildResponse, HMRServerMessage };
export { hmrWsUrl, parseHmrMessage } from "./hmr/protocol";

type RouteUpdatePayload = {
	pathname: string;
	routeName: string;
	generation: number;
	component: () => Promise<() => JSX.Element>;
};

export type HmrConnectionStatus =
	| "connecting"
	| "open"
	| "reconnecting"
	| "closed";

type SetupHMRCallbacks = {
	onRoutesUpdate: (route: RouteUpdatePayload) => Promise<void> | void;
	onRouteBuildStarted?: (route: {
		pathname: string;
		routeName: string;
		generation: number;
	}) => Promise<void> | void;
	onRouteBuildMissing?: (route: {
		pathname: string;
		generation: number;
	}) => Promise<void> | void;
	onBuildFailed?: (payload: {
		pathname?: string;
		routeName?: string;
		generation: number;
		error: { message: string; stack?: string };
	}) => Promise<void> | void;
	onFullReload?: (payload: {
		reason: string;
		generation: number;
	}) => Promise<void> | void;
	/** Per-file graph: a single module under moduleRoot changed */
	onInvalidateModule?: (payload: {
		path: string;
		t: number;
		generation: number;
	}) => Promise<void> | void;
	onStatusChange?: (status: HmrConnectionStatus) => void;
	getPathname?: () => string;
	tabId?: string;
	reconnect?: { initialMs?: number; maxMs?: number };
	heartbeatMs?: number;
};

type Listener = (message: HMRServerMessage) => void | Promise<void>;

let sharedWs: WebSocket | undefined;
const listeners = new Set<Listener>();
let status: HmrConnectionStatus = "closed";
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let intentionalClose = false;
let sharedOptions: {
	reconnect: { initialMs: number; maxMs: number };
	heartbeatMs: number;
	getPathname: () => string;
	tabId: string;
	onStatusChange?: (status: HmrConnectionStatus) => void;
} = {
	reconnect: { initialMs: 400, maxMs: 10_000 },
	heartbeatMs: 25_000,
	getPathname: () =>
		typeof window !== "undefined" ? window.location.pathname : "/",
	tabId: "default",
};

function setStatus(next: HmrConnectionStatus) {
	if (status === next) return;
	status = next;
	sharedOptions.onStatusChange?.(next);
}

function clearHeartbeat() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

function startHeartbeat() {
	clearHeartbeat();
	if (sharedOptions.heartbeatMs <= 0) return;
	heartbeatTimer = setInterval(() => {
		if (sharedWs?.readyState === WebSocket.OPEN) {
			sharedWs.send(
				JSON.stringify({ v: HMR_PROTOCOL_VERSION, type: "ping" }),
			);
		}
	}, sharedOptions.heartbeatMs);
}

function sendClientHello() {
	if (sharedWs?.readyState !== WebSocket.OPEN) return;
	sharedWs.send(
		JSON.stringify({
			v: HMR_PROTOCOL_VERSION,
			type: "client-hello",
			pathname: sharedOptions.getPathname(),
			tabId: sharedOptions.tabId,
		}),
	);
}

function scheduleReconnect() {
	if (intentionalClose) return;
	if (reconnectTimer) return;
	const { initialMs, maxMs } = sharedOptions.reconnect;
	const delay = Math.min(
		maxMs,
		initialMs * 2 ** reconnectAttempt + Math.random() * 200,
	);
	reconnectAttempt += 1;
	setStatus("reconnecting");
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connectSocket();
	}, delay);
}

function connectSocket() {
	if (
		sharedWs &&
		(sharedWs.readyState === WebSocket.OPEN ||
			sharedWs.readyState === WebSocket.CONNECTING)
	) {
		return;
	}

	intentionalClose = false;
	setStatus(reconnectAttempt > 0 ? "reconnecting" : "connecting");

	const ws = new WebSocket(hmrWsUrl());
	sharedWs = ws;

	ws.addEventListener("open", () => {
		reconnectAttempt = 0;
		setStatus("open");
		sendClientHello();
		startHeartbeat();
	});

	ws.addEventListener("message", async (event) => {
		const message = parseHmrMessage(String(event.data));
		if (!message) {
			console.warn("[Apply-React HMR] Received malformed websocket payload");
			return;
		}
		// client messages ignored on client
		if (
			message.type === "client-hello" ||
			message.type === "ping" ||
			message.type === "pong"
		) {
			return;
		}
		for (const listener of listeners) {
			try {
				await listener(message as HMRServerMessage);
			} catch (error) {
				console.error("[Apply-React HMR] Callback handling failed", error);
			}
		}
	});

	ws.addEventListener("close", () => {
		clearHeartbeat();
		if (sharedWs === ws) sharedWs = undefined;
		setStatus("closed");
		scheduleReconnect();
	});

	ws.addEventListener("error", () => {
		// close handler will reconnect
		try {
			ws.close();
		} catch {
			// ignore
		}
	});
}

/**
 * Initializes Hot Module Replacement for client-side route updates.
 * Failsafe: wss/ws, reconnect with backoff, heartbeat, safe parse.
 */
export function setupHMR(
	callbacks:
		| SetupHMRCallbacks
		| ((route: RouteUpdatePayload) => Promise<void> | void),
) {
	const opts: SetupHMRCallbacks =
		typeof callbacks === "function" ? { onRoutesUpdate: callbacks } : callbacks;

	sharedOptions = {
		reconnect: {
			initialMs: opts.reconnect?.initialMs ?? 400,
			maxMs: opts.reconnect?.maxMs ?? 10_000,
		},
		heartbeatMs: opts.heartbeatMs ?? 25_000,
		getPathname:
			opts.getPathname ??
			(() => (typeof window !== "undefined" ? window.location.pathname : "/")),
		tabId:
			opts.tabId ??
			(typeof crypto !== "undefined" && "randomUUID" in crypto
				? crypto.randomUUID()
				: `tab-${Math.random().toString(36).slice(2)}`),
		onStatusChange: opts.onStatusChange,
	};

	const listener: Listener = async (message) => {
		switch (message.type) {
			case "update-routes":
				await opts.onRoutesUpdate({
					pathname: message.pathname,
					routeName: message.routeName,
					generation: message.generation,
					component: () =>
						import(
							`/@apply-react/routes/${message.route}?t=${Date.now()}`
						).then((mod) => mod.default as () => JSX.Element),
				});
				return;
			case "route-build-started":
				await opts.onRouteBuildStarted?.({
					pathname: message.pathname,
					routeName: message.routeName,
					generation: message.generation,
				});
				return;
			case "route-build-missing":
				await opts.onRouteBuildMissing?.({
					pathname: message.pathname,
					generation: message.generation,
				});
				return;
			case "build-failed":
				await opts.onBuildFailed?.({
					pathname: message.pathname,
					routeName: message.routeName,
					generation: message.generation,
					error: message.error,
				});
				return;
			case "full-reload":
				await opts.onFullReload?.({
					reason: message.reason,
					generation: message.generation,
				});
				return;
			case "invalidate-module":
				await opts.onInvalidateModule?.({
					path: message.path,
					t: message.t,
					generation: message.generation,
				});
				return;
			default:
				return;
		}
	};

	listeners.add(listener);
	connectSocket();

	// Keep server informed of navigations
	const pathReporter = () => {
		sendClientHello();
	};
	if (typeof window !== "undefined") {
		window.addEventListener("popstate", pathReporter);
	}

	return () => {
		listeners.delete(listener);
		if (typeof window !== "undefined") {
			window.removeEventListener("popstate", pathReporter);
		}
		if (listeners.size === 0) {
			intentionalClose = true;
			clearHeartbeat();
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			try {
				sharedWs?.close();
			} catch {
				// ignore
			}
			sharedWs = undefined;
			setStatus("closed");
		}
	};
}

/** @internal test helper — reset singleton socket state */
export function __resetHmrClientForTests() {
	intentionalClose = true;
	clearHeartbeat();
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	try {
		sharedWs?.close();
	} catch {
		// ignore
	}
	sharedWs = undefined;
	listeners.clear();
	reconnectAttempt = 0;
	status = "closed";
	intentionalClose = false;
}

export async function requestDevRouteBuild(
	pathname: string,
	options?: { retries?: number; timeoutMs?: number },
): Promise<DevRouteBuildResponse> {
	const retries = options?.retries ?? 2;
	const timeoutMs = options?.timeoutMs ?? 15_000;
	let lastError: unknown;

	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			const response = await fetch(
				`/_REACT_HMR/build-route?pathname=${encodeURIComponent(pathname)}`,
				{
					headers: { accept: "application/json" },
					signal: controller.signal,
				},
			);
			clearTimeout(timer);

			if (!response.ok && response.status !== 404) {
				throw new Error(
					`Failed to request dev route build for ${pathname} (${response.status})`,
				);
			}

			return (await response.json()) as DevRouteBuildResponse;
		} catch (error) {
			lastError = error;
			if (attempt < retries) {
				await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
			}
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`Failed to request dev route build for ${pathname}`);
}

/** Notify server of current pathname (call after SPA navigations). */
export function reportActivePathname(pathname: string) {
	sharedOptions.getPathname = () => pathname;
	sendClientHello();
}
