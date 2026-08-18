import { describe, expect, test } from "bun:test";
import { createContext } from "react";
import {
	getOrCreateRefreshContext,
	initializeReactRefresh,
} from "../src/react-refresh-runtime";

describe("getOrCreateRefreshContext", () => {
	test("installs the React Refresh globals once", () => {
		initializeReactRefresh();
		initializeReactRefresh();

		const refreshGlobal = globalThis as typeof globalThis & {
			$RefreshReg$?: unknown;
			$RefreshSig$?: unknown;
		};
		expect(refreshGlobal.$RefreshReg$).toBeFunction();
		expect(refreshGlobal.$RefreshSig$).toBeFunction();
	});

	test("keeps an exported context identity stable across module re-evaluation", () => {
		let initialFactoryCalls = 0;
		const initialContext = getOrCreateRefreshContext(
			"test/shared-context.ts",
			"SharedContext",
			() => {
				initialFactoryCalls += 1;
				return createContext({ value: "initial" });
			},
		);

		let refreshedFactoryCalls = 0;
		const refreshedContext = getOrCreateRefreshContext(
			"test/shared-context.ts",
			"SharedContext",
			() => {
				refreshedFactoryCalls += 1;
				return createContext({ value: "refreshed" });
			},
		);

		expect(initialContext).toBe(refreshedContext);
		expect(initialFactoryCalls).toBe(1);
		expect(refreshedFactoryCalls).toBe(0);
	});
});
