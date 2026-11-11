#!/usr/bin/env node
// Syntax-checks the extension sources (the extension has no build step, so this is its compile gate).
//
//   ES modules: *.mjs, extension/devtools/panel/**/*.js, every file loaded by a
//               <script type="module" src> in an extension HTML page, and everything those
//               files import statically (relative specifiers)
//   classic scripts: every other extension/**/*.js (background, content script, devtools page,
//               popup, dev/ preview harness): must not contain import/export
//
// Files are piped through `node --input-type=<type> --check` on stdin. Plain `node --check file.js`
// is not enough: with module syntax detection (Node 22+) it silently passes a broken ES module.
// The generated / vendored IIFE bundles in extension/vendor/*.js are skipped.
//
// Usage: node scripts/check-extension.mjs   (from the repo root; no dependencies)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");
const extensionDir = join(root, "extension");

function walk(dir, pattern) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path, pattern));
    else if (pattern.test(entry.name)) out.push(path);
  }
  return out;
}

// Module graph: <script type="module" src> entries of every HTML page, plus their static imports.
const moduleFiles = new Set();
const pending = [];
for (const html of walk(extensionDir, /\.html$/)) {
  for (const m of readFileSync(html, "utf8").matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src && /\btype\s*=\s*["']module["']/i.test(tag) && !/^[a-z]+:/i.test(src)) pending.push(resolve(dirname(html), src));
  }
}
while (pending.length > 0) {
  const file = pending.pop();
  if (moduleFiles.has(file) || !existsSync(file)) continue;
  moduleFiles.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) pending.push(resolve(dirname(file), m[1]));
}

function kindOf(file, rel) {
  const parts = rel.split(sep);
  if (parts[0] === "vendor") return rel.endsWith(".mjs") ? "module" : null; // generated / vendored IIFEs: skipped
  if (rel.endsWith(".mjs") || moduleFiles.has(file)) return "module";
  if (parts[0] === "devtools" && parts[1] === "panel") return "module";
  return "commonjs"; // classic script: must not contain import/export
}

const files = walk(extensionDir, /\.m?js$/).sort();
let failed = 0;
let checked = 0;
for (const file of files) {
  const rel = relative(extensionDir, file);
  const kind = kindOf(file, rel);
  if (!kind) continue;
  const result = spawnSync(process.execPath, [`--input-type=${kind}`, "--check"], {
    input: readFileSync(file),
    encoding: "utf8",
  });
  checked += 1;
  if (result.status !== 0) {
    failed += 1;
    const detail = (result.stderr || "")
      .split("\n")
      .filter((l) => !/^(Node\.js v|\s+at |\(node:\d+\) Warning|\(Use `node)/.test(l))
      .join("\n")
      .replaceAll("[stdin]", `extension/${rel}`)
      .trim();
    console.error(`FAIL extension/${rel} (${kind === "module" ? "ES module" : "classic script"})\n${detail}\n`);
  }
}

if (failed > 0) {
  console.error(`check-extension: ${failed} of ${checked} file(s) failed the syntax check.`);
  process.exit(1);
}
console.log(`check-extension: ${checked} file(s) OK.`);
