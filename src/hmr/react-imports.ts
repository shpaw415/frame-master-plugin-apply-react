/** Bare package specifiers → browser-absolute URLs matching Bun entry outputs. */
export const REACT_BARE_TO_URL: Record<string, string> = {
	react: "/react.js",
	"react-dom": "/react-dom.js",
	"react-dom/client": "/react-dom/client.js",
	"react/jsx-runtime": "/react/jsx-runtime.js",
	"react/jsx-dev-runtime": "/react/jsx-dev-runtime.js",
};

/** Stable DOM id so injection is idempotent across build/runtime rewrites. */
export const IMPORT_MAP_SCRIPT_ID = "__apply_react_importmap__";

const REACT_BARE_SPECS = Object.keys(REACT_BARE_TO_URL)
	// longest first so react-dom/client matches before react-dom
	.sort((a, b) => b.length - a.length)
	.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
	.join("|");

/**
 * Rewrite bare react/* import/export specifiers to absolute `/react…js` URLs.
 * Needed because browsers cannot resolve bare specifiers without an import map,
 * and Bun keeps the original bare path when a module is marked external.
 */
export function rewriteBareReactImportsToUrls(code: string): string {
	if (!code.includes("react")) return code;

	// from "react" / from 'react/jsx-dev-runtime' / import("react-dom/client")
	const fromOrDynamic = new RegExp(
		`((?:import|export)\\s+[^'";\\n]*?\\sfrom\\s+|import\\s*\\(\\s*)(["'])(${REACT_BARE_SPECS})\\2`,
		"g",
	);
	let out = code.replace(
		fromOrDynamic,
		(full, prefix: string, q: string, spec: string) => {
			const url = REACT_BARE_TO_URL[spec];
			if (!url) return full;
			return `${prefix}${q}${url}${q}`;
		},
	);

	// side-effect: import "react/jsx-dev-runtime"
	const sideEffect = new RegExp(
		`(import\\s+)(["'])(${REACT_BARE_SPECS})\\2`,
		"g",
	);
	out = out.replace(
		sideEffect,
		(full, prefix: string, q: string, spec: string) => {
			const url = REACT_BARE_TO_URL[spec];
			if (!url) return full;
			return `${prefix}${q}${url}${q}`;
		},
	);

	return out;
}

export function importMapJson(): string {
	return JSON.stringify({ imports: { ...REACT_BARE_TO_URL } });
}

/** Full `<script type="importmap">` tag for HTML injection. */
export function importMapScriptTag(): string {
	return `<script type="importmap" id="${IMPORT_MAP_SCRIPT_ID}" data-apply-react-importmap="1">${importMapJson()}</script>`;
}

export function htmlHasImportMap(html: string): boolean {
	return (
		html.includes(`id="${IMPORT_MAP_SCRIPT_ID}"`) ||
		html.includes('data-apply-react-importmap="1"') ||
		html.includes("data-apply-react-importmap='1'")
	);
}

/**
 * Idempotently inject the import map at the earliest valid position in HTML
 * so it precedes any `type="module"` scripts (browser requirement).
 *
 * Used by `build.finally("html")` and as a string-level failsafe.
 */
export function injectImportMapIntoHtml(html: string): string {
	if (!html || htmlHasImportMap(html)) return html;

	const tag = importMapScriptTag();

	// Immediately after <head ...> (preferred — before any head scripts)
	if (/<head\b[^>]*>/i.test(html)) {
		return html.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`);
	}

	// After <html ...> wrap a head if missing
	if (/<html\b[^>]*>/i.test(html)) {
		return html.replace(
			/<html\b[^>]*>/i,
			(open) => `${open}<head>${tag}</head>`,
		);
	}

	// Doctype-only / fragment
	if (/<!doctype\s+html[^>]*>/i.test(html)) {
		return html.replace(
			/<!doctype\s+html[^>]*>/i,
			(d) => `${d}<head>${tag}</head>`,
		);
	}

	return `${tag}${html}`;
}
