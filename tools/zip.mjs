// Packs dist/ into game.zip for itch.io (index.html at the zip's root).
// On Windows, uses the built-in bsdtar (C:\Windows\System32\tar.exe), which writes real zip files;
// GNU tar (e.g. Git Bash's) ignores -a and would write a tar archive named .zip.
// Elsewhere, uses the standard `zip` tool.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "game.zip");
const dist = path.join(root, "dist");
if (!existsSync(path.join(dist, "index.html"))) throw new Error("dist/index.html missing: run the build first");
rmSync(out, { force: true });

if (process.platform === "win32") {
	const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
	// List the top-level entries (not "."), so paths are "index.html", not "./index.html"
	execFileSync(tar, ["-a", "-c", "-f", out, "-C", dist, ...readdirSync(dist)], { stdio: "inherit" });
} else {
	execFileSync("zip", ["-r", "-q", out, "."], { cwd: dist, stdio: "inherit" });
}
console.log("wrote", out);
