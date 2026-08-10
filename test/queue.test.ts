import { describe, expect, test } from "bun:test";
import { DevBuildQueue } from "../src/hmr/queue";

describe("DevBuildQueue", () => {
	test("dedupes by route name and shifts FIFO", () => {
		const q = new DevBuildQueue();
		const a = {
			pathname: "/a",
			matchedRoute: { name: "/a" } as Bun.MatchedRoute,
		};
		const b = {
			pathname: "/b",
			matchedRoute: { name: "/b" } as Bun.MatchedRoute,
		};
		const a2 = {
			pathname: "/a2",
			matchedRoute: { name: "/a" } as Bun.MatchedRoute,
		};

		expect(q.enqueue(a)).toBe(true);
		expect(q.enqueue(a2)).toBe(false);
		expect(q.enqueue(b)).toBe(true);
		expect(q.size).toBe(2);
		expect(q.shift()?.pathname).toBe("/a");
		expect(q.shift()?.pathname).toBe("/b");
		expect(q.isEmpty).toBe(true);
	});
});
