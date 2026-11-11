#!/usr/bin/env node
// Builds the Chrome Web Store zip of the DevTools extension:
//   dist-extension/perf-intelligence-devtools-<manifest version>.zip
//
// - Packs extension/ as is (the extension has no build step; extension/vendor/* is the checked-in
//   output of `cd core && npm run build:extension`).
// - Leaves out the dev-only preview harness (extension/dev/**), dotfiles and OS junk.
// - Fails when a path referenced by manifest.json (icons, action, service worker, devtools page,
//   content scripts) or by the background (the injected engine bundle) is missing, when an HTML
//   page references a missing local file, or when the vendor bundles are absent.
//
// Uses only Node built-ins plus the system `zip` CLI (macOS / Linux; on Windows use WSL or Git Bash).
// Usage: node scripts/package-extension.mjs [--out <dir>]
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const extDir = join(root, "extension");
const outArg = process.argv.indexOf("--out");
const outDir = resolve(root, outArg > 0 ? process.argv[outArg + 1] : "dist-extension");

const EXCLUDE_DIRS = new Set(["dev", "node_modules"]); // top-level extension/ folders not shipped
const EXCLUDE_FILES = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$|^\./;

function fail(message) {
  console.error(`package-extension: ${message}`);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_FILES.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const rel = relative(extDir, path).split(sep).join("/");
    if (entry.isDirectory()) {
      if (!rel.includes("/") && EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...walk(path));
    } else out.push(rel);
  }
  return out;
}

// ── Manifest checks ──────────────────────────────────────────────────

const manifestPath = join(extDir, "manifest.json");
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
  fail(`extension/manifest.json is not valid JSON (${err.message})`);
}
if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.version))) fail(`invalid manifest version "${manifest.version}"`);
if (typeof manifest.description !== "string" || manifest.description.length > 132) fail("manifest description must be a string of at most 132 characters (Chrome Web Store limit)");
if (typeof manifest.name !== "string" || manifest.name.length > 75) fail("manifest name must be at most 75 characters");

const referenced = new Set();
const add = (p, from) => {
  if (typeof p !== "string" || !p) return;
  referenced.add(JSON.stringify([p.replace(/^\.?\//, ""), from]));
};
for (const p of Object.values(manifest.icons || {})) add(p, "icons");
for (const p of Object.values(manifest.action?.default_icon || {})) add(p, "action.default_icon");
add(manifest.action?.default_popup, "action.default_popup");
add(manifest.background?.service_worker, "background.service_worker");
add(manifest.devtools_page, "devtools_page");
add(manifest.options_page, "options_page");
add(manifest.options_ui?.page, "options_ui.page");
for (const cs of manifest.content_scripts || []) {
  for (const p of cs.js || []) add(p, "content_scripts.js");
  for (const p of cs.css || []) add(p, "content_scripts.css");
}
// Loaded at runtime by background.js / the panel, not named in the manifest.
add("vendor/perf-engine.inject.js", "background.js (registerContentScripts)");
for (const v of ["perf-analyzer.mjs", "a11y-audit.js", "a11y-rules.mjs", "axe.min.js", "ibm-ace.js"]) add(`vendor/${v}`, "DevTools panel");
add("THIRD_PARTY_NOTICES.txt", "panel footer (Open-source credits)");

const missing = [];
for (const item of referenced) {
  const [p, from] = JSON.parse(item);
  if (!existsSync(join(extDir, p))) missing.push(`${p} (${from})`);
}

// Local references in shipped HTML pages: <script src>, <link href>, <img src>.
const files = walk(extDir).sort();
for (const rel of files.filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(join(extDir, rel), "utf8");
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const ref = m[1];
    if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(ref)) continue;
    const target = posix.normalize(posix.join(posix.dirname(rel), ref.split(/[?#]/)[0]));
    if (target.startsWith("..") || target.startsWith("dev/") || !existsSync(join(extDir, target))) missing.push(`${target} (referenced by ${rel})`);
  }
}
if (missing.length) fail(`missing or unshippable files:\n  ${missing.join("\n  ")}`);

// ── Zip ──────────────────────────────────────────────────────────────

const which = spawnSync("zip", ["-v"], { encoding: "utf8" });
if (which.error || which.status !== 0) fail("the `zip` command is not available (install zip, or use WSL / Git Bash on Windows)");

mkdirSync(outDir, { recursive: true });
const zipName = `perf-intelligence-devtools-${manifest.version}.zip`;
const zipPath = join(outDir, zipName);
rmSync(zipPath, { force: true });

// -X: no extra file attributes (reproducible-ish), -q quiet, -9 max compression; file list on stdin.
const res = spawnSync("zip", ["-X", "-q", "-9", zipPath, "-@"], { cwd: extDir, input: files.join("\n") + "\n", encoding: "utf8" });
if (res.status !== 0) fail(`zip failed: ${res.stderr || res.stdout}`);

const bytes = statSync(zipPath).size;
const totalRaw = files.reduce((n, f) => n + statSync(join(extDir, f)).size, 0);
console.log(`package-extension: ${relative(root, zipPath)} (${files.length} files, ${(totalRaw / 1024 / 1024).toFixed(2)} MB -> ${(bytes / 1024 / 1024).toFixed(2)} MB)`);
if (process.argv.includes("--list")) for (const f of files) console.log(`  ${f}`);

