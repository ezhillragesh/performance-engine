#!/usr/bin/env node
// Vendor drift check: regenerates the extension bundles from core and fails if the result differs
// from what is committed. extension/vendor/* and extension/THIRD_PARTY_NOTICES.txt are generated
// (cd core && npm run build:extension) and checked in, because the extension has no build step.
//
// Usage: node scripts/check-vendor.mjs   (from the repo root; needs core/node_modules and git)
//   --no-build   only compare, do not regenerate first
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const paths = ["extension/vendor", "extension/THIRD_PARTY_NOTICES.txt"];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: process.platform === "win32", ...options });
  if (result.error) throw result.error;
  return result;
}

if (!process.argv.includes("--no-build")) {
  const build = run(npm, ["--prefix", "core", "run", "build:extension"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// --porcelain lists modified, deleted AND untracked files (git diff alone misses new files).
const status = run("git", ["status", "--porcelain", "--untracked-files=all", "--", ...paths]);
if (status.status !== 0) {
  console.error(status.stderr.trim() || "check-vendor: git status failed");
  process.exit(status.status ?? 1);
}
const drift = status.stdout.trim();
if (drift) {
  console.error("check-vendor: the generated extension bundles are out of date with core/:\n");
  console.error(drift);
  const diff = run("git", ["--no-pager", "diff", "--stat", "--", ...paths]);
  if (diff.stdout.trim()) console.error(`\n${diff.stdout.trim()}`);
  console.error("\nRun `cd core && npm run build:extension` and commit extension/vendor + extension/THIRD_PARTY_NOTICES.txt.");
  process.exit(1);
}
console.log("check-vendor: extension/vendor and THIRD_PARTY_NOTICES.txt match core.");
