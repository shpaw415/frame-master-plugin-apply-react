import { describe, expect, test } from "bun:test";
import { NotFoundError, ThrowNotFound } from "../src/utils";

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
