import type { Context } from "react";
import RefreshRuntime from "react-refresh/runtime";

type RefreshRegistration = (type: unknown, localId: string) => void;
type RefreshSignature = ReturnType<
	typeof RefreshRuntime.createSignatureFunctionForTransform
>;

type RefreshGlobal = typeof globalThis & {
	$RefreshReg$?: RefreshRegistration;
	$RefreshSig$?: RefreshSignature;
};

const contextRegistrySymbol = Symbol.for(
	"frame-master-plugin-apply-react.react-refresh.contexts",
);
const refreshInitializedSymbol = Symbol.for(
	"frame-master-plugin-apply-react.react-refresh.initialized",
);

function getContextRegistry() {
	const refreshGlobal = globalThis as typeof globalThis & {
		[contextRegistrySymbol]?: Map<string, Context<unknown>>;
	};
	const existingRegistry = refreshGlobal[contextRegistrySymbol];
	if (existingRegistry) return existingRegistry;

	const registry = new Map<string, Context<unknown>>();
	refreshGlobal[contextRegistrySymbol] = registry;
	return registry;
}

export function getOrCreateRefreshContext<Value>(
	moduleId: string,
	exportName: string,
	create: () => Context<Value>,
): Context<Value> {
	const key = `${moduleId}:${exportName}`;
	const registry = getContextRegistry();
	const existing = registry.get(key);
	if (existing) return existing as Context<Value>;

	const context = create();
	registry.set(key, context as Context<unknown>);
	return context;
}

export function initializeReactRefresh() {
	const refreshGlobal = globalThis as typeof globalThis & {
		[refreshInitializedSymbol]?: boolean;
	};
	if (refreshGlobal[refreshInitializedSymbol]) return;

	RefreshRuntime.injectIntoGlobalHook(globalThis);
	const refreshGlobals = globalThis as RefreshGlobal;
	refreshGlobals.$RefreshReg$ ??= () => {};
	refreshGlobals.$RefreshSig$ ??=
		RefreshRuntime.createSignatureFunctionForTransform;
	refreshGlobal[refreshInitializedSymbol] = true;
}

export function enterReactRefreshModule(moduleId: string) {
	initializeReactRefresh();
	const refreshGlobal = globalThis as RefreshGlobal;
	const previousRegister = refreshGlobal.$RefreshReg$;
	const previousSignature = refreshGlobal.$RefreshSig$;

	refreshGlobal.$RefreshReg$ = (type, localId) => {
		RefreshRuntime.register(type, `${moduleId} ${localId}`);
	};
	refreshGlobal.$RefreshSig$ =
		RefreshRuntime.createSignatureFunctionForTransform;

	return () => {
		refreshGlobal.$RefreshReg$ = previousRegister;
		refreshGlobal.$RefreshSig$ = previousSignature;
	};
}

export function performReactRefresh() {
	initializeReactRefresh();
	RefreshRuntime.performReactRefresh();
}

if (typeof window !== "undefined") {
	initializeReactRefresh();
}
