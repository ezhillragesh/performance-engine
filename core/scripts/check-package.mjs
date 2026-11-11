// Verifies the npm package like a consumer would (run after `npm run build`; `npm run check:package`
// does both). Fully offline: the package has no dependencies, so the tarball is extracted directly.
//   1. `npm pack` into a temp dir: expected files only, no tests / build scripts / side-effect entries,
//      every source map self-contained (sourcesContent), no declaration maps pointing at unshipped .ts.
//   2. Node ESM import of the installed tarball, without a DOM: exports exist, importing defines no
//      globals and schedules nothing, initPerfEngine / analysis / the a11y audit do not throw.
//   3. tsc on a consumer file (skipLibCheck: false) with moduleResolution bundler, node16 and nodenext.
//   4. esbuild browser bundles: tree-shaking keeps the a11y audit and the React hook out unless used.
// Usage: cd core && npm run check:package   (KEEP_TMP=1 keeps the temp project for inspection)
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
};

if (!existsSync(join(coreDir, "dist", "index.js"))) {
  console.error("dist/ is missing: run `npm run build` first (or `npm run check:package`).");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "perf-engine-pack-"));
try {
  // ── 1. tarball contents ──────────────────────────────────────────────
  console.log("\n[1] npm pack");
  const packed = JSON.parse(
    execFileSync(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", work], { cwd: coreDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
  )[0];
  const files = packed.files.map((f) => f.path);
  console.log(`       ${packed.filename}: ${files.length} files, ${(packed.size / 1024).toFixed(1)} kB packed, ${(packed.unpackedSize / 1024).toFixed(1)} kB unpacked`);
  for (const required of ["package.json", "README.md", "LICENSE", "dist/index.js", "dist/index.d.ts", "dist/THIRD_PARTY_NOTICES.md"]) {
    check(files.includes(required), `ships ${required}`);
  }
  const forbidden = files.filter((f) => /(^|\/)(tests?|bench|inject|scripts|__tests__)\//.test(f) || /\.(test|bench)\.|(^|\/)browser\.(js|d\.ts)$|\.ts$(?<!\.d\.ts)|\.d\.ts\.map$|\.tgz$/.test(f));
  check(forbidden.length === 0, `no tests, scripts, injected entries, TS sources or declaration maps${forbidden.length ? `: ${forbidden.slice(0, 5).join(", ")}` : ""}`);
  check(files.every((f) => f === "package.json" || f === "README.md" || f === "LICENSE" || f.startsWith("dist/")), "only dist/, README.md, LICENSE, package.json");

  const consumer = join(work, "consumer");
  const installDir = join(consumer, "node_modules", pkg.name);
  mkdirSync(join(consumer, "node_modules"), { recursive: true });
  execFileSync("tar", ["-xzf", join(work, packed.filename), "-C", join(consumer, "node_modules")]);
  renameSync(join(consumer, "node_modules", "package"), installDir);

  let dangling = 0;
  let maps = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".map")) {
        maps += 1;
        const map = JSON.parse(readFileSync(path, "utf8"));
        const inline = Array.isArray(map.sourcesContent) && map.sourcesContent.length === map.sources.length && map.sourcesContent.every((s) => typeof s === "string");
        if (!inline) dangling += 1;
      } else if (name.endsWith(".js")) {
        const js = readFileSync(path, "utf8");
        const bare = [...js.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]).filter((spec) => !spec.startsWith("."));
        const extensionless = [...js.matchAll(/\bfrom\s+["'](\.[^"']*)["']/g)].map((m) => m[1]).filter((spec) => !spec.endsWith(".js"));
        if (bare.length || extensionless.length) failures.push(`${path}: bare or extensionless import ${[...bare, ...extensionless].join(", ")}`);
      }
    }
  };
  walk(join(installDir, "dist"));
  check(dangling === 0, `${maps} source maps embed their sources (no dangling references)`);
  check(!failures.some((f) => f.includes("bare or extensionless")), "dist imports are relative with explicit .js suffixes (Node ESM)");

  // ── 2. Node ESM import without a DOM ────────────────────────────────
  console.log("\n[2] Node ESM import (no DOM)");
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  writeFileSync(
    join(consumer, "node-smoke.mjs"),
    `const before = new Set(Object.getOwnPropertyNames(globalThis));
const pe = await import(${JSON.stringify(pkg.name)});
const added = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
const expected = ["initPerfEngine", "instrumentReact", "analyzeEvents", "buildAnalysisContext", "computeSummary", "buildTraceSummaries",
  "evaluateBudgets", "DEFAULT_BUDGETS", "defaultRules", "explainInsight", "trackRender", "createProfilerOnRender", "runInTrace", "runDetached",
  "startAction", "trackAction", "startWebVitalsTracking", "rateWebVital", "WEB_VITAL_THRESHOLDS", "runA11yAudit", "mergeA11yReports",
  "UNIFIED_RULES", "ENGINE_VERSION", "PROTOCOL_VERSION"];
const missing = expected.filter((name) => !(name in pe));
const session = pe.initPerfEngine();
const snapshot = session.getSnapshot();
JSON.stringify(snapshot);
const result = {
  added, missing, version: pe.ENGINE_VERSION, sampled: session.sampled, vitalsLcp: snapshot.vitals.lcp,
  insights: pe.analyzeEvents([]).length, a11yError: pe.runA11yAudit().error ?? null,
  action: pe.trackAction("smoke", () => "ran"),
};
session.stop();
const leftovers = Object.getOwnPropertyNames(globalThis).filter((k) => !before.has(k));
result.leftovers = leftovers;
console.log(JSON.stringify(result));
`,
  );
  const started = Date.now();
  const smoke = JSON.parse(execFileSync(process.execPath, ["node-smoke.mjs"], { cwd: consumer, encoding: "utf8", timeout: 20_000 }).trim());
  check(smoke.missing.length === 0, `exports present${smoke.missing.length ? ` (missing: ${smoke.missing.join(", ")})` : ""}`);
  check(smoke.added.length === 0, `import defines no globals${smoke.added.length ? ` (added: ${smoke.added.join(", ")})` : ""}`);
  check(smoke.version === pkg.version, `ENGINE_VERSION ${smoke.version} = package version ${pkg.version}`);
  check(smoke.sampled === true && smoke.vitalsLcp === null && smoke.insights === 0 && smoke.action === "ran", "initPerfEngine / analyzeEvents / trackAction work in Node (SSR)");
  check(typeof smoke.a11yError === "string", `runA11yAudit() without a DOM reports instead of throwing ("${smoke.a11yError}")`);
  check(smoke.leftovers.length === 0, `stop() leaves no globals behind${smoke.leftovers.length ? ` (${smoke.leftovers.join(", ")})` : ""}`);
  check(Date.now() - started < 15_000, "the process exits on its own (no timers keep Node alive)");

  // ── 3. TypeScript consumers ─────────────────────────────────────────
  console.log("\n[3] TypeScript consumer (skipLibCheck: false)");
  writeFileSync(
    join(consumer, "consumer.ts"),
    `import {
  initPerfEngine, instrumentReact, analyzeEvents, trackAction, startAction, rateWebVital, runA11yAudit, DEFAULT_BUDGETS,
  type PerfEngineConfig, type PerfEngineSession, type Insight, type TrackedEvent, type WebVitals, type AnalysisRule,
  type PerfSnapshot, type A11yReport, type ActionHandle, type TraceSummary,
} from ${JSON.stringify(pkg.name)};

const rule: AnalysisRule = { name: "custom", run: () => [] };
const config: PerfEngineConfig = { sampleRate: 0.5, budgets: { interactionLatencyMs: 150 }, customRules: [rule], onInsights: (list: Insight[]) => void list };
const stopReact: () => void = instrumentReact({ ignore: [/^Styled/] });
const session: PerfEngineSession = initPerfEngine(config);
const vitals: WebVitals = session.getWebVitals();
const rating: "good" | "needs-improvement" | "poor" | null = rateWebVital("inp", vitals.inp);
const snapshot: PerfSnapshot = session.getSnapshot({ maxEvents: 100 });
const traces: TraceSummary[] = snapshot.traces;
const events: TrackedEvent[] = snapshot.events;
const insights: Insight[] = analyzeEvents(events, { budgets: DEFAULT_BUDGETS });
const handle: ActionHandle = startAction("checkout");
const answer: Promise<number> = trackAction("save", async () => 42);
const report: A11yReport = runA11yAudit(null, { include: "errors" });
handle.end();
stopReact();
session.stop();
export { rating, traces, insights, answer, report };
`,
  );
  const tsc = join(coreDir, "node_modules", "typescript", "bin", "tsc");
  const base = { strict: true, noEmit: true, skipLibCheck: false, target: "ES2020", lib: ["ES2021", "DOM", "DOM.Iterable"], types: [] };
  for (const [label, options] of [
    ["bundler", { module: "ESNext", moduleResolution: "Bundler" }],
    ["node16", { module: "Node16", moduleResolution: "Node16" }],
    ["nodenext", { module: "NodeNext", moduleResolution: "NodeNext" }],
  ]) {
    writeFileSync(join(consumer, `tsconfig.${label}.json`), JSON.stringify({ compilerOptions: { ...base, ...options }, files: ["consumer.ts"] }));
    let output = "";
    try {
      execFileSync(process.execPath, [tsc, "-p", `tsconfig.${label}.json`], { cwd: consumer, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    }
    check(output === "", `typechecks with moduleResolution ${label}${output ? `\n${output.split("\n").slice(0, 8).join("\n")}` : ""}`);
  }

  // ── 4. tree-shaking ─────────────────────────────────────────────────
  console.log("\n[4] esbuild browser bundles (minified)");
  const bundle = async (name, source) => {
    const entry = join(consumer, `${name}.entry.js`);
    writeFileSync(entry, source);
    const result = await build({ entryPoints: [entry], bundle: true, minify: true, format: "esm", platform: "browser", target: "es2020", write: false, logLevel: "silent" });
    const code = result.outputFiles[0].text;
    console.log(`       ${name.padEnd(10)} ${(code.length / 1024).toFixed(1).padStart(6)} kB min, ${(gzipSync(code).length / 1024).toFixed(1).padStart(5)} kB gzip`);
    return code;
  };
  const a11yMarker = "data-perf-intel-a11y";
  const hookMarker = "__REACT_DEVTOOLS_GLOBAL_HOOK__";
  const analyzer = await bundle("analyzer", `import { analyzeEvents } from ${JSON.stringify(pkg.name)};\nexport const run = (events) => analyzeEvents(events);\n`);
  check(!analyzer.includes(a11yMarker) && !analyzer.includes(hookMarker) && !analyzer.includes("PerformanceObserver"), "analyzeEvents alone: no a11y audit, no React hook, no trackers");
  const engine = await bundle("engine", `import { initPerfEngine, instrumentReact } from ${JSON.stringify(pkg.name)};\ninstrumentReact();\nexport const session = initPerfEngine();\n`);
  check(!engine.includes(a11yMarker), "initPerfEngine + instrumentReact: no a11y audit");
  check(engine.includes(hookMarker), "instrumentReact is included when used");
  const a11y = await bundle("a11y", `import { runA11yAudit } from ${JSON.stringify(pkg.name)};\nexport const audit = () => runA11yAudit();\n`);
  check(a11y.includes(a11yMarker) && !a11y.includes(hookMarker), "runA11yAudit alone: the audit, without the engine's React hook");
  const empty = await bundle("import", `import ${JSON.stringify(pkg.name)};\n`);
  check(empty.trim().length === 0, "a bare side-effect import bundles to nothing (sideEffects: false)");
} finally {
  if (process.env.KEEP_TMP) console.log(`\nkept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} package check(s) failed.`);
  process.exit(1);
}
console.log("\nPackage checks passed.");
