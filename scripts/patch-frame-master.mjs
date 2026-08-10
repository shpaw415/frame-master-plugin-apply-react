import { readFileSync, writeFileSync, existsSync } from "node:fs";
const target =
	"node_modules/frame-master/src/server/request-manager.ts";
if (!existsSync(target)) process.exit(0);
const src = readFileSync(target, "utf8");
if (!src.includes("frame-master/plugins")) process.exit(0);
writeFileSync(
	target,
	src.replaceAll("frame-master/plugins", "frame-master/plugin"),
);
console.log("[patch-frame-master] fixed frame-master/plugins import");
