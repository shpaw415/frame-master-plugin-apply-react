/**
 * Configuration options for the Apply-React plugin
 */
export type ApplyReactHmrOptions = {
	heartbeatMs?: number;
	reconnect?: { initialMs?: number; maxMs?: number };
	debounceMs?: number;
	/** When runtime modules change, broadcast full-reload (default true). */
	fullReloadOnRuntimeChange?: boolean;
	/** Show client error overlay (default true). */
	overlay?: boolean;
	/**
	 * Dev module graph strategy.
	 * - `per-file` (default when HMR on): each `moduleRoot` file is a real build
	 *   entrypoint → path-stable `/@apply-react/mod/*.js` artifacts (plugin pipeline
	 *   applies). HMR rebuilds then cache-busts with `?t=`.
	 * - `bundled`: legacy selective route bundles with splitting
	 */
	moduleGraph?: "bundled" | "per-file";
	/**
	 * Which files under `moduleRoot` become build entrypoints (per-file mode).
	 * - `all` (default): every source file under moduleRoot
	 * - `reachable`: only modules reachable from routes + shell + fallbacks
	 */
	entrypointMode?: "reachable" | "all";
	/**
	 * Prefer soft page swaps without remounting ErrorWrapper (default true).
	 */
	preserveState?: boolean;
};

export type ApplyReactPluginOptions = {
	/** Routing style convention (currently supports "nextjs") */
	style: "nextjs";

	/** Base path to the routes directory (e.g., "src/pages" or "app/pages") */
	route: string;

	/**
	 * Root directory for stable per-file modules (customizable — not fixed to "src").
	 * Inferred from `route` when omitted (parent of `…/pages`, else `src` if present).
	 */
	moduleRoot?: string;

	/**
	 * Optional path to a custom client-side shell component
	 *
	 * Used as a wrapper for the RouterHost or global shell during hydration.
	 * Put durable React providers here (above RouterHost) so they survive page HMR.
	 */
	clientShellPath?: string;

	/**
	 * Enable Hot Module Replacement for development
	 *
	 * @default true when NODE_ENV !== "production"
	 */
	enableHMR?: boolean;

	/**
	 * Hydration method to use on the client
	 *
	 * - `"hydrate"`: Attaches event listeners to existing server-rendered HTML (default)
	 * - `"render"`: Fully re-renders the component tree on the client via createRoot
	 *
	 * @default "hydrate"
	 */
	hydration?: "hydrate" | "render";

	/**
	 * Set Custom entrypoints extensions
	 *
	 * @default [".tsx", ".jsx"]
	 */
	entrypointExtensions?: string[];

	/**
	 * Directories watched for HMR file changes (project-root relative).
	 * @default [moduleRoot]
	 */
	watchDirectories?: string[];

	/**
	 * Directories excluded from HMR watching; applied after `watchDirectories`.
	 */
	watchDirectoriesExclude?: string[];

	/** Advanced HMR tuning */
	hmr?: ApplyReactHmrOptions;

	/** Verbose Apply-React logs (or set DEBUG_APPLY_REACT=1) */
	debug?: boolean;

	/**
	 * default fallbacks pages
	 */
	fallbacks?: Partial<{
		/**
		 * Path to a custom 404 Not Found component
		 */
		defaultNotFoundComponentPath?: string;
		/**
		 * Path to a custom Loading component
		 */
		defaultLoadingComponentPath?: string;
	}>;
};
