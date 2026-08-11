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

/** Match any importmap script (attribute order tolerant). */
const IMPORT_MAP_SCRIPT_RE =
	/<script\b[^>]*\btype\s*=\s*["']importmap["'][^>]*>[\s\S]*?<\/script>/gi;

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

export function importMapJson(
	imports: Record<string, string> = REACT_BARE_TO_URL,
): string {
	return JSON.stringify({ imports: { ...imports } });
}

/** Full `<script type="importmap">` tag for HTML injection. */
export function importMapScriptTag(
	imports: Record<string, string> = REACT_BARE_TO_URL,
): string {
	return `<script type="importmap" id="${IMPORT_MAP_SCRIPT_ID}" data-apply-react-importmap="1">${importMapJson(imports)}</script>`;
}

/** True if HTML contains any import map (ours or foreign). */
export function htmlHasImportMap(html: string): boolean {
	return /type\s*=\s*["']importmap["']/i.test(html);
}

export function htmlHasOurImportMap(html: string): boolean {
	return (
		html.includes(`id="${IMPORT_MAP_SCRIPT_ID}"`) ||
		html.includes('data-apply-react-importmap="1"') ||
		html.includes("data-apply-react-importmap='1'")
	);
}

export type ParsedImportMapScript = {
	fullMatch: string;
	body: string;
	imports: Record<string, string>;
	isOurs: boolean;
	parseOk: boolean;
};

/**
 * Extract all `<script type="importmap">` blocks in document order.
 */
export function parseImportMapScripts(html: string): ParsedImportMapScript[] {
	const out: ParsedImportMapScript[] = [];
	const re = new RegExp(IMPORT_MAP_SCRIPT_RE.source, "gi");
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) != null) {
		const fullMatch = m[0];
		const openEnd = fullMatch.indexOf(">");
		const closeStart = fullMatch.lastIndexOf("</");
		const body =
			openEnd >= 0 && closeStart > openEnd
				? fullMatch.slice(openEnd + 1, closeStart).trim()
				: "";
		const isOurs =
			fullMatch.includes(IMPORT_MAP_SCRIPT_ID) ||
			fullMatch.includes("data-apply-react-importmap");
		let imports: Record<string, string> = {};
		let parseOk = false;
		try {
			const parsed = JSON.parse(body) as { imports?: Record<string, string> };
			if (parsed && typeof parsed === "object" && parsed.imports) {
				imports = { ...parsed.imports };
				parseOk = true;
			}
		} catch {
			parseOk = false;
		}
		out.push({ fullMatch, body, imports, isOurs, parseOk });
	}
	return out;
}

/**
 * Merge import maps in document order, then overlay apply-react react/* keys
 * (ours win on conflict for those keys).
 */
export function mergeImportMaps(
	maps: Array<Record<string, string>>,
	ours: Record<string, string> = REACT_BARE_TO_URL,
): Record<string, string> {
	const merged: Record<string, string> = {};
	for (const m of maps) {
		Object.assign(merged, m);
	}
	Object.assign(merged, ours);
	return merged;
}

function stripAllImportMaps(html: string): string {
	return html.replace(new RegExp(IMPORT_MAP_SCRIPT_RE.source, "gi"), "");
}

function insertTagAfterHeadOpen(html: string, tag: string): string {
	if (/<head\b[^>]*>/i.test(html)) {
		return html.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`);
	}
	if (/<html\b[^>]*>/i.test(html)) {
		return html.replace(
			/<html\b[^>]*>/i,
			(open) => `${open}<head>${tag}</head>`,
		);
	}
	if (/<!doctype\s+html[^>]*>/i.test(html)) {
		return html.replace(
			/<!doctype\s+html[^>]*>/i,
			(d) => `${d}<head>${tag}</head>`,
		);
	}
	return `${tag}${html}`;
}

/**
 * Ensure exactly one canonical import map early in `<head>`.
 *
 * - No map → inject ours
 * - Ours only → replace body with canonical (merge preserved foreign keys if any)
 * - Foreign map(s) → merge imports, overlay react keys, single tag
 * - Multiple maps → collapse to one merged tag
 *
 * Never leaves two `type="importmap"` scripts in the document.
 */
export function ensureSingleImportMapInHtml(html: string): string {
	if (!html) return html;

	const existing = parseImportMapScripts(html);
	const merged = mergeImportMaps(
		existing.filter((e) => e.parseOk).map((e) => e.imports),
		REACT_BARE_TO_URL,
	);
	const tag = importMapScriptTag(merged);

	// Fast path: already exactly one map and body matches canonical
	if (existing.length === 1) {
		const only = existing[0]!;
		if (only.parseOk && only.fullMatch === tag) {
			return html;
		}
		// Compare JSON payloads (ignore attribute noise)
		if (only.parseOk) {
			try {
				const want = importMapJson(merged);
				const got = JSON.stringify({ imports: only.imports });
				// Normalize key order via parse
				const wantNorm = JSON.stringify(JSON.parse(want));
				const gotNorm = JSON.stringify({
					imports: JSON.parse(got).imports,
				});
				if (
					wantNorm === gotNorm &&
					only.isOurs &&
					htmlHasOurImportMap(only.fullMatch)
				) {
					return html;
				}
			} catch {
				// fall through to replace
			}
		}
	}

	const stripped = stripAllImportMaps(html);
	return insertTagAfterHeadOpen(stripped, tag);
}

/**
 * @deprecated Use {@link ensureSingleImportMapInHtml} — merge/replace/collapse.
 * Kept as alias for external callers.
 */
export function injectImportMapIntoHtml(html: string): string {
	return ensureSingleImportMapInHtml(html);
}
