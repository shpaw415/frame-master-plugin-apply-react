import { importMapJson, IMPORT_MAP_SCRIPT_ID } from "./hmr/react-imports";

export {
	REACT_BARE_TO_URL,
	IMPORT_MAP_SCRIPT_ID,
	importMapJson,
	importMapScriptTag,
	injectImportMapIntoHtml,
	htmlHasImportMap,
	rewriteBareReactImportsToUrls,
} from "./hmr/react-imports";

export type ApplyReactImportMapProps = {
	/**
	 * When false, render nothing (e.g. production if you only need absolute
	 * rewritten imports). Default true.
	 */
	enabled?: boolean;
};

/**
 * SSR/shell helper: emits the React bare-specifier import map as early as possible.
 *
 * Place inside your document `<head>` (server shell / react-to-html shell) so the
 * browser can resolve `react`, `react/jsx-dev-runtime`, etc. before any module runs.
 *
 * The build pipeline also injects this via `finally("html")`; this component is
 * the explicit DX hook when you control the shell markup.
 *
 * @example
 * ```tsx
 * // src/shell.tsx (react-to-html)
 * import { ApplyReactImportMap } from "frame-master-plugin-apply-react/import-map";
 *
 * export default function Shell({ children }) {
 *   return (
 *     <html>
 *       <head>
 *         <ApplyReactImportMap />
 *         <title>App</title>
 *       </head>
 *       <body>
 *         <div id="root">{children}</div>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function ApplyReactImportMap({
	enabled = true,
}: ApplyReactImportMapProps = {}) {
	if (!enabled) return null;

	return (
		<script
			id={IMPORT_MAP_SCRIPT_ID}
			type="importmap"
			// data-* marker for injectImportMapIntoHtml idempotency checks
			{...{ "data-apply-react-importmap": "1" }}
			// Import maps must be raw JSON text content (not a JS expression).
			dangerouslySetInnerHTML={{ __html: importMapJson() }}
		/>
	);
}

export default ApplyReactImportMap;
