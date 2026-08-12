import { describe, expect, test } from "bun:test";
import { transformReactRefreshModule } from "../src/react-refresh-transform";

describe("transformReactRefreshModule", () => {
	test("stabilizes exported contexts and registers component refresh boundaries", async () => {
		const transformed = await transformReactRefreshModule(
			`
				import React, { createContext as makeContext } from "react";

				export const SharedContext = makeContext({ value: 0 });
				export const SecondaryContext = React.createContext<string | null>(null);
				const localContext = makeContext({ value: "local" });
				export function Page() {
					return <div>{localContext.displayName}</div>;
				}
			`,
			{ filename: "/project/src/contexts.tsx", moduleId: "src/contexts.tsx" },
		);

		expect(transformed).toContain("enterReactRefreshModule");
		expect(transformed).toContain(
			'getOrCreateRefreshContext("src/contexts.tsx", "SharedContext"',
		);
		expect(transformed).toContain(
			'getOrCreateRefreshContext("src/contexts.tsx", "SecondaryContext"',
		);
		expect(transformed).toContain(
			'const localContext = makeContext({\n  value: "local"\n});',
		);
		expect(transformed).toContain('$RefreshReg$(_c, "Page")');
		expect(transformed).toContain("__applyReactLeaveRefreshModule();");
	});
});
