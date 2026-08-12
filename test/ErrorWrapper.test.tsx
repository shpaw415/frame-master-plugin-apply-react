import { describe, expect, mock, test } from "bun:test";
import { createElement, type JSX } from "react";
import { renderToString } from "react-dom/server";
import { type ErrorFallbackResolver, ErrorWrapper } from "../src/router";
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

	test("renders the built-in fallback while resolver selection is pending", () => {
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [],
		});
		instance.state = {
			error: new Error("test"),
			FallbackComponent: null,
			componentStack: null,
		};

		const result = instance.render() as JSX.Element;
		expect(result).not.toBeNull();
		expect(result.type).not.toBe("div");
	});

	test("renders children to HTML string when no error", () => {
		const html = renderToString(
			createElement(
				ErrorWrapper,
				{ resolvers: [] } as unknown as React.ComponentProps<
					typeof ErrorWrapper
				>,
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

		expect(setStateSpy).toHaveBeenCalledTimes(2);
		expect(setStateSpy.mock.calls.at(-1)?.at(0)).toEqual({
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

	test("stores component metadata when no resolver matches", async () => {
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [async () => null, async () => null],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new Error("no match"));

		expect(setStateSpy).toHaveBeenCalledWith({ componentStack: null });
	});

	test("passes the thrown error and current pathname to each resolver", async () => {
		const error = new NotFoundError();
		const pathname = "/users/42";
		window.history.replaceState(null, "", pathname);

		const resolver: ErrorFallbackResolver = mock(async () => FallbackPage);
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [resolver],
		});
		instance.setState = mock(() => {}) as unknown as typeof instance.setState;

		await instance.componentDidCatch(error);

		expect(resolver).toHaveBeenCalledWith(
			error,
			pathname,
			expect.any(Function),
		);

		// Restore
		window.history.replaceState(null, "", "/");
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

	test("reports error details and uses the custom fallback after resolvers", async () => {
		const onError = mock(() => {});
		const CustomFallback = ({ pathname }: { pathname: string }) =>
			createElement("div", null, `Fallback for ${pathname}`);
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [async () => null],
			onError,
			errorFallback: CustomFallback,
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new Error("boom"), {
			componentStack: "\n    at Child",
		});

		expect(onError).toHaveBeenCalledWith(new Error("boom"), {
			pathname: "/",
			componentStack: "\n    at Child",
		});
		expect(setStateSpy).toHaveBeenCalledTimes(2);
		const fallbackState = setStateSpy.mock.calls.at(-1)?.at(0) as {
			FallbackComponent: () => JSX.Element;
		};
		expect(fallbackState.FallbackComponent().type).toBe(CustomFallback);
	});

	test("keeps a matching resolver ahead of the custom fallback", async () => {
		const CustomFallback = () => createElement("div", null, "Custom");
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [async () => FallbackPage],
			errorFallback: CustomFallback,
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		await instance.componentDidCatch(new Error("boom"));

		expect(setStateSpy.mock.calls.at(-1)?.at(0)).toEqual({
			FallbackComponent: FallbackPage,
		});
	});

	test("reset clears the captured error state", () => {
		const instance = new ErrorWrapper({
			children: createElement(Child, null),
			resolvers: [],
		});
		const setStateSpy = mock(() => {});
		instance.setState = setStateSpy as unknown as typeof instance.setState;

		instance.reset();

		expect(setStateSpy).toHaveBeenCalledWith({
			error: null,
			FallbackComponent: null,
			componentStack: null,
		});
	});
});
