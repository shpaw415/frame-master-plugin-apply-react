import { describe, expect, test } from "bun:test";
import {
	classifyWatchPath,
	filePathToPathname,
	getRoutePathnameFromFileChange,
	isSpecialRouteName,
	resolveWatchDirectories,
	shouldIgnoreWatchPath,
} from "../src/hmr/watch";

const root = "/workspace/app";
const routeDir = "/workspace/app/src/pages";

describe("filePathToPathname", () => {
	test("maps index and nested pages", () => {
		expect(filePathToPathname("index.tsx")).toBe("/");
		expect(filePathToPathname("sub/index.tsx")).toBe("/sub");
		expect(filePathToPathname("sub/[id].tsx")).toBe("/sub/[id]");
	});
});

describe("classifyWatchPath", () => {
	test("classifies page vs special files", () => {
		expect(
			classifyWatchPath(root, routeDir, `${routeDir}/about.tsx`).kind,
		).toBe("page");
		expect(
			classifyWatchPath(root, routeDir, `${routeDir}/layout.tsx`).kind,
		).toBe("layout");
		expect(
			classifyWatchPath(root, routeDir, `${routeDir}/sub/loading.tsx`).kind,
		).toBe("loading");
		expect(
			classifyWatchPath(root, routeDir, `${routeDir}/sub/404.tsx`).kind,
		).toBe("not-found");
		expect(
			classifyWatchPath(root, routeDir, `${root}/src/lib/util.ts`).kind,
		).toBe("shared");
	});

	test("classifies runtime paths", () => {
		const shell = `${root}/src/client-shell.tsx`;
		expect(
			classifyWatchPath(root, routeDir, shell, [shell]).kind,
		).toBe("runtime");
	});
});

describe("getRoutePathnameFromFileChange", () => {
	test("returns pathname only for pages", () => {
		expect(
			getRoutePathnameFromFileChange(
				root,
				routeDir,
				"src/pages/sub/index.tsx",
			),
		).toBe("/sub");
		expect(
			getRoutePathnameFromFileChange(root, routeDir, "src/pages/layout.tsx"),
		).toBeNull();
		expect(
			getRoutePathnameFromFileChange(
				root,
				routeDir,
				"src/client-shell.tsx",
			),
		).toBeNull();
	});
});

describe("resolveWatchDirectories", () => {
	test("applies excludes", () => {
		const dirs = resolveWatchDirectories(
			root,
			[".", "node_modules"],
			["node_modules"],
		);
		expect(dirs.every((d) => !d.endsWith("node_modules"))).toBe(true);
	});
});

describe("shouldIgnoreWatchPath", () => {
	test("ignores build output and node_modules", () => {
		expect(
			shouldIgnoreWatchPath(root, `${root}/.frame-master/build/x.js`),
		).toBe(true);
		expect(shouldIgnoreWatchPath(root, `${root}/node_modules/x.js`)).toBe(
			true,
		);
		expect(shouldIgnoreWatchPath(root, `${root}/src/lib/util.ts`)).toBe(
			false,
		);
	});
});

describe("isSpecialRouteName", () => {
	test("detects layout/loading/404", () => {
		expect(isSpecialRouteName("/layout")).toBe(true);
		expect(isSpecialRouteName("/sub/layout")).toBe(true);
		expect(isSpecialRouteName("/sub/loading")).toBe(true);
		expect(isSpecialRouteName("/sub/404")).toBe(true);
		expect(isSpecialRouteName("/sub")).toBe(false);
		expect(isSpecialRouteName("/")).toBe(false);
	});
});
