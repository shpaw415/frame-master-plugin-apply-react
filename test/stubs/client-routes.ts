const routes: Record<string, () => Promise<() => JSX.Element>> = {
	"/": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/layout": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/loading": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/404": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/sub": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/sub/loading": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/sub/404": () => Promise.resolve(() => null as unknown as JSX.Element),
	"/sub/[id]": () => Promise.resolve(() => null as unknown as JSX.Element),
};
export default routes;
