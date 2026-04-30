import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ErrorWrapper, type ErrorFallbackResolver } from "../src/router";
import { NotFoundError } from "../src/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Child() {
	return createElement("span", null, "content");
}

function FallbackPage() {
	return createElement("div", { id: "fallback" }, "Fallback");
}

// ---------------------------------------------------------------------------
// getDerivedStateFromError
// ---------------------------------------------------------------------------

describe("ErrorWrapper.getDerivedStateFromError", () => {
	test("returns the thrown error in { error }", () => {
		const error = new Error("boom");
		const state = ErrorWrapper.getDerivedStateFromError(error);
		expect(state.error).toBe(error);
	});

	test("works with NotFoundError subclass", () => {
		const error = new NotFoundError();
		const state = ErrorWrapper.getDerivedStateFromError(error);
		expect(state.error).toBeInstanceOf(NotFoundError);
	});
});

// ---------------------------------------------------------------------------
// render()
// ---------------------------------------------------------------------------

describe("ErrorWrapper.render", () => {
	test("returns children when no error", () => {
		const child = createElement(Child, null);
		const instance = new ErrorWrapper({ children: child, resolvers: [] });
		expect(instance.render()).toBe(child);
	});

	test("returns a FallbackComponent element when error + fallback resolved", () => {
		const child = createElement(Child, null);
		const instance = new ErrorWrapper({ children: child, resolvers: [] });
		instance.state = {
			error: new Error("test"),
			FallbackComponent: FallbackPage,
		};

		const result = instance.render() as JSX.Element;
		expect(result).not.toBeNull();
		expect(result).not.toBe(child);
		// The rendered element should be createElement(FallbackPage, null)
		expect(result.type).toBe(FallbackPage);
	});

	test("returns null when error is set but FallbackComponent not yet resolved", () => {
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [],
		});
		instance.state = { error: new Error("test"), FallbackComponent: null };
		expect(instance.render()).toBeNull();
	});

	test("renders children to HTML string when no error", () => {
		const html = renderToString(
			createElement(
				ErrorWrapper,
				{ resolvers: [] },
				createElement(Child, null),
			),
		);
		expect(html).toContain("content");
	});
});

// ---------------------------------------------------------------------------
// componentDidCatch resolver chain
// ---------------------------------------------------------------------------

describe("ErrorWrapper.componentDidCatch", () => {
	test("calls setState with the first resolver that returns a component", async () => {
		const resolverA: ErrorFallbackResolver = async () => FallbackPage;
		const resolverB = mock(async (): Promise<null> => null);

		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [resolverA, resolverB],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new Error("boom"));

		expect(setStateSpy).toHaveBeenCalledTimes(1);
		expect(setStateSpy.mock.calls.at(0)?.at(0)).toEqual({
			FallbackComponent: FallbackPage,
		});
		// Stops at first match – second resolver must NOT be invoked
		expect(resolverB).not.toHaveBeenCalled();
	});

	test("falls through to next resolver when first returns null", async () => {
		const resolverA: ErrorFallbackResolver = async () => null;
		const resolverB: ErrorFallbackResolver = async () => FallbackPage;

		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [resolverA, resolverB],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new Error("boom"));

		expect(setStateSpy).toHaveBeenCalledWith({
			FallbackComponent: FallbackPage,
		});
	});

	test("does not call setState when no resolver matches", async () => {
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [async () => null, async () => null],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new Error("no match"));

		expect(setStateSpy).not.toHaveBeenCalled();
	});

	test("passes the thrown error and current pathname to each resolver", async () => {
		const error = new NotFoundError();
		const pathname = "/users/42";
		(globalThis as unknown as { location: { pathname: string } }).location = {
			pathname,
		};

		const resolver: ErrorFallbackResolver = mock(async () => FallbackPage);
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [resolver],
		});
		instance.setState = mock(() => {}) as unknown as typeof instance.setState;

		await instance.componentDidCatch(error);

		expect(resolver).toHaveBeenCalledWith(error, pathname);

		// Restore
		(globalThis as unknown as { location: { pathname: string } }).location = {
			pathname: "/",
		};
	});

	test("custom error type resolver stops chain on match", async () => {
		class UnauthorizedError extends Error {}

		const customResolver: ErrorFallbackResolver = async (err) =>
			err instanceof UnauthorizedError ? FallbackPage : null;
		const notFoundResolver = mock(async (): Promise<null> => null);

		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [customResolver, notFoundResolver],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new UnauthorizedError("forbidden"));

		expect(setStateSpy).toHaveBeenCalledWith({
			FallbackComponent: FallbackPage,
		});
		expect(notFoundResolver).not.toHaveBeenCalled();
	});

	test("custom error falls through to later resolver when not matched", async () => {
		class UnauthorizedError extends Error {}

		const customResolver: ErrorFallbackResolver = async (err) =>
			err instanceof UnauthorizedError ? FallbackPage : null;
		const catchAllResolver: ErrorFallbackResolver = mock(
			async () => FallbackPage,
		);

		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [customResolver, catchAllResolver],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		// Not an UnauthorizedError – customResolver returns null, catchAll handles it
		await instance.componentDidCatch(new Error("generic"));

		expect(catchAllResolver).toHaveBeenCalled();
		expect(setStateSpy).toHaveBeenCalledWith({
			FallbackComponent: FallbackPage,
		});
	});
});
