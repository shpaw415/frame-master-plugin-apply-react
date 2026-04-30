// In Bun test runtime, "window" as a bare identifier is not defined.
// The source code uses globalThis.location?.pathname which works both in
// browsers (location === globalThis.location) and here.
(globalThis as any).location = { pathname: "/" };
