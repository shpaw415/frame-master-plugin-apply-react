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
};

export type ApplyReactPluginOptions = {
	/** Routing style convention (currently supports "nextjs") */
	style: "nextjs";

	/** Base path to the routes directory (e.g., "src/pages") */
	route: string;

	/**
	 * Optional path to a custom client-side shell component
	 *
	 * Used as a wrapper for the RouterHost or global shell during hydration.
	 * If not provided, the default client shell will be used.
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
	 * @default ["."]
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
