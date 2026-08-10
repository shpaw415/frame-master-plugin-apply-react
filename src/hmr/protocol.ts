/** HMR protocol v1 — shared client/server message shapes. */

export const HMR_PROTOCOL_VERSION = 1 as const;

export type HmrErrorPayload = {
	message: string;
	stack?: string;
};

export type RouteUpdateMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	generation: number;
	type: "update-routes";
	route: string;
	pathname: string;
	routeName: string;
};

export type RouteBuildStartedMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	generation: number;
	type: "route-build-started";
	pathname: string;
	routeName: string;
};

export type RouteBuildMissingMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	generation: number;
	type: "route-build-missing";
	pathname: string;
};

export type RouteBuildFailedMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	generation: number;
	type: "build-failed";
	pathname?: string;
	routeName?: string;
	error: HmrErrorPayload;
};

export type FullReloadMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	generation: number;
	type: "full-reload";
	reason: string;
};

export type ServerHelloMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	generation: number;
	type: "server-hello";
};

export type ClientHelloMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	type: "client-hello";
	pathname: string;
	tabId: string;
};

export type PingMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	type: "ping";
};

export type PongMessage = {
	v: typeof HMR_PROTOCOL_VERSION;
	type: "pong";
};

export type HMRServerMessage =
	| RouteUpdateMessage
	| RouteBuildStartedMessage
	| RouteBuildMissingMessage
	| RouteBuildFailedMessage
	| FullReloadMessage
	| ServerHelloMessage
	| PongMessage;

export type HMRClientMessage = ClientHelloMessage | PingMessage;

export type HMRMessage = HMRServerMessage | HMRClientMessage;

export type DevRouteBuildResponse =
	| {
			status: "building";
			pathname: string;
			routeName: string;
			generation: number;
	  }
	| {
			status: "missing";
			pathname: string;
			generation: number;
	  };

export function hmrWsUrl(host = window.location.host): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${host}/_REACT_HMR/ws`;
}

export function parseHmrMessage(raw: unknown): HMRMessage | null {
	let data: unknown = raw;
	if (typeof raw === "string") {
		try {
			data = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!data || typeof data !== "object") return null;
	const msg = data as Record<string, unknown>;
	if (msg.v !== HMR_PROTOCOL_VERSION && msg.v !== undefined) {
		// accept legacy messages without v by normalizing below
	}
	const type = msg.type;
	if (typeof type !== "string") return null;

	switch (type) {
		case "update-routes":
			if (
				typeof msg.route === "string" &&
				typeof msg.pathname === "string" &&
				typeof msg.routeName === "string"
			) {
				return {
					v: HMR_PROTOCOL_VERSION,
					generation: numberOrZero(msg.generation),
					type: "update-routes",
					route: msg.route,
					pathname: msg.pathname,
					routeName: msg.routeName,
				};
			}
			return null;
		case "route-build-started":
			if (
				typeof msg.pathname === "string" &&
				typeof msg.routeName === "string"
			) {
				return {
					v: HMR_PROTOCOL_VERSION,
					generation: numberOrZero(msg.generation),
					type: "route-build-started",
					pathname: msg.pathname,
					routeName: msg.routeName,
				};
			}
			return null;
		case "route-build-missing":
			if (typeof msg.pathname === "string") {
				return {
					v: HMR_PROTOCOL_VERSION,
					generation: numberOrZero(msg.generation),
					type: "route-build-missing",
					pathname: msg.pathname,
				};
			}
			return null;
		case "build-failed":
			if (
				msg.error &&
				typeof msg.error === "object" &&
				typeof (msg.error as HmrErrorPayload).message === "string"
			) {
				return {
					v: HMR_PROTOCOL_VERSION,
					generation: numberOrZero(msg.generation),
					type: "build-failed",
					pathname:
						typeof msg.pathname === "string" ? msg.pathname : undefined,
					routeName:
						typeof msg.routeName === "string" ? msg.routeName : undefined,
					error: {
						message: (msg.error as HmrErrorPayload).message,
						stack:
							typeof (msg.error as HmrErrorPayload).stack === "string"
								? (msg.error as HmrErrorPayload).stack
								: undefined,
					},
				};
			}
			return null;
		case "full-reload":
			if (typeof msg.reason === "string") {
				return {
					v: HMR_PROTOCOL_VERSION,
					generation: numberOrZero(msg.generation),
					type: "full-reload",
					reason: msg.reason,
				};
			}
			return null;
		case "server-hello":
			return {
				v: HMR_PROTOCOL_VERSION,
				generation: numberOrZero(msg.generation),
				type: "server-hello",
			};
		case "client-hello":
			if (typeof msg.pathname === "string" && typeof msg.tabId === "string") {
				return {
					v: HMR_PROTOCOL_VERSION,
					type: "client-hello",
					pathname: msg.pathname,
					tabId: msg.tabId,
				};
			}
			return null;
		case "ping":
			return { v: HMR_PROTOCOL_VERSION, type: "ping" };
		case "pong":
			return { v: HMR_PROTOCOL_VERSION, type: "pong" };
		default:
			return null;
	}
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function errorToPayload(error: unknown): HmrErrorPayload {
	if (error instanceof Error) {
		return { message: error.message, stack: error.stack };
	}
	return { message: String(error) };
}
