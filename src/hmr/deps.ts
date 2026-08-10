import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TRACKED_SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".mts",
	".cts",
	".json",
	".css",
]);

const NON_RECURSIVE_EXTENSIONS = new Set([".json", ".css"]);

const IMPORT_SPECIFIER_PATTERNS = [
	/(?:import|export)\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']/g,
	/import\s*["']([^"']+)["']/g,
	/import\s*\(\s*["']([^"']+)["']\s*\)/g,
	/require\s*\(\s*["']([^"']+)["']\s*\)/g,
];

export function extractImportSpecifiers(source: string): string[] {
	const specifiers = new Set<string>();
	for (const pattern of IMPORT_SPECIFIER_PATTERNS) {
		for (const match of source.matchAll(pattern)) {
			const specifier = match[1]?.trim();
			if (specifier) specifiers.add(specifier);
		}
	}
	return [...specifiers];
}

function isWithinProject(projectRoot: string, filePath: string) {
	const relativePath = relative(projectRoot, filePath);
	return (
		relativePath !== "" &&
		!relativePath.startsWith("..") &&
		!relativePath.startsWith("/")
	);
}

function isIgnored(projectRoot: string, filePath: string) {
	if (!isWithinProject(projectRoot, filePath)) return true;
	const relativePath = relative(projectRoot, filePath);
	return (
		relativePath.startsWith(".git/") ||
		relativePath.startsWith(".frame-master/") ||
		relativePath.startsWith("release-notes/") ||
		relativePath.startsWith("node_modules/")
	);
}

function resolveWithKnownExtensions(candidatePath: string) {
	if (existsSync(candidatePath)) return candidatePath;
	for (const extension of TRACKED_SOURCE_EXTENSIONS) {
		const withExtension = `${candidatePath}${extension}`;
		if (existsSync(withExtension)) return withExtension;
	}
	for (const extension of TRACKED_SOURCE_EXTENSIONS) {
		const asIndex = join(candidatePath, `index${extension}`);
		if (existsSync(asIndex)) return asIndex;
	}
	return null;
}

function resolveImportSpecifier(
	sourceFilePath: string,
	specifier: string,
	projectRoot: string,
) {
	if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
		return null;
	}
	if (specifier.startsWith(".") || specifier.startsWith("/")) {
		const fromSource = specifier.startsWith("/")
			? resolve(projectRoot, `.${specifier}`)
			: resolve(join(sourceFilePath, ".."), specifier);
		return resolveWithKnownExtensions(fromSource);
	}
	try {
		const resolvedUrl = import.meta.resolve(
			specifier,
			pathToFileURL(sourceFilePath).href,
		);
		if (!resolvedUrl.startsWith("file:")) return null;
		const resolved = fileURLToPath(resolvedUrl);
		// Only track project-local deps, not full node_modules tree
		if (relative(projectRoot, resolved).startsWith("node_modules")) {
			return null;
		}
		return resolveWithKnownExtensions(resolved);
	} catch {
		return null;
	}
}

/**
 * Walk local imports from a route entry file (no deep node_modules crawl).
 */
export async function collectFileDependencies(
	entryFilePath: string,
	projectRoot: string,
): Promise<Set<string>> {
	const stack = [resolve(projectRoot, entryFilePath)];
	const discovered = new Set<string>();

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) continue;
		const normalized = resolve(projectRoot, current);
		if (discovered.has(normalized)) continue;
		if (isIgnored(projectRoot, normalized)) continue;
		discovered.add(normalized);

		if (!existsSync(normalized)) continue;
		const extension = extname(normalized);
		if (!TRACKED_SOURCE_EXTENSIONS.has(extension)) continue;
		if (NON_RECURSIVE_EXTENSIONS.has(extension)) continue;

		let source: string;
		try {
			source = await readFile(normalized, "utf8");
		} catch {
			continue;
		}

		for (const specifier of extractImportSpecifiers(source)) {
			const resolved = resolveImportSpecifier(
				normalized,
				specifier,
				projectRoot,
			);
			if (!resolved) continue;
			if (isIgnored(projectRoot, resolved)) continue;
			if (!discovered.has(resolved)) stack.push(resolved);
		}
	}

	return discovered;
}

/**
 * Map absolute dependency path → route names that import it.
 */
export async function buildRouteDependencyIndex(
	routes: Record<string, string>,
	projectRoot: string,
): Promise<Map<string, Set<string>>> {
	const index = new Map<string, Set<string>>();
	for (const [routeName, filePath] of Object.entries(routes)) {
		const deps = await collectFileDependencies(filePath, projectRoot);
		for (const dep of deps) {
			const set = index.get(dep) ?? new Set<string>();
			set.add(routeName);
			index.set(dep, set);
		}
	}
	return index;
}
