import { describe, expect, test } from "bun:test";
import {
	getLocationHref,
	isSameLocation,
	NotFoundError,
	ThrowNotFound,
} from "../src/utils";

describe("getLocationHref", () => {
	test("joins pathname, search, and hash into a comparable href", () => {
		expect(
			getLocationHref({
				pathname: "/about",
				search: "?tab=team",
				hash: "#members",
			}),
		).toBe("/about?tab=team#members");
	});
});

describe("isSameLocation", () => {
	test("returns true when pathname, search, and hash all match", () => {
		expect(
			isSameLocation(
				{ pathname: "/about", search: "", hash: "" },
				{ pathname: "/about", search: "", hash: "" },
			),
		).toBe(true);
	});

	test("returns false when only the search differs", () => {
		expect(
			isSameLocation(
				{ pathname: "/about", search: "", hash: "" },
				{ pathname: "/about", search: "?tab=team", hash: "" },
			),
		).toBe(false);
	});

	test("returns false when only the hash differs", () => {
		expect(
			isSameLocation(
				{ pathname: "/about", search: "", hash: "" },
				{ pathname: "/about", search: "", hash: "#members" },
			),
		).toBe(false);
	});
});

describe("NotFoundError", () => {
	test("is an instance of Error", () => {
		expect(new NotFoundError()).toBeInstanceOf(Error);
	});

	test("has name 'NotFoundError'", () => {
		expect(new NotFoundError().name).toBe("NotFoundError");
	});

	test("has message 'Not Found'", () => {
		expect(new NotFoundError().message).toBe("Not Found");
	});

	test("preserves instanceof check after throw/catch", () => {
		let caught: unknown;
		try {
			throw new NotFoundError();
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(NotFoundError);
		expect(caught).toBeInstanceOf(Error);
	});
});

describe("ThrowNotFound", () => {
	test("throws a NotFoundError", () => {
		expect(() => ThrowNotFound()).toThrow(NotFoundError);
	});

	test("thrown error has message 'Not Found'", () => {
		try {
			ThrowNotFound();
		} catch (e) {
			expect((e as Error).message).toBe("Not Found");
		}
	});

	test("thrown error name is 'NotFoundError'", () => {
		try {
			ThrowNotFound();
		} catch (e) {
			expect((e as Error).name).toBe("NotFoundError");
		}
	});
});
