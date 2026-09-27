// The vendored engines in extension/vendor are byte-for-byte copies of the devDependencies (plus a
// header) and load through the panel's wrappers. Regenerate with `npm run build:extension`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AXE_CORE_VERSION, IBM_ACE_VERSION, wrapAceSource, wrapAxeSource } from "../loaders.js";
import { aceSource, acePath, axeSource, makeWindow } from "./engines.js";

const ext = resolve(dirname(fileURLToPath(import.meta.url)), "../../../extension");
const read = (p: string) => readFileSync(resolve(ext, p), "utf8");

describe("vendored engines", () => {
  it("ibm-ace.js is ace.js unchanged, with header and license", () => {
    const v = read("vendor/ibm-ace.js");
    expect(v.endsWith(aceSource())).toBe(true);
    expect(v.split("\n")[0]).toBe(`// GENERATED copy of accessibility-checker-engine@${IBM_ACE_VERSION} ace.js — Apache-2.0 — do not edit.`);
    const license = readFileSync(resolve(dirname(acePath()), "ace.js.LICENSE.txt"), "utf8").trim();
    expect(v).toContain(license);
    expect(read("vendor/ibm-ace.LICENSE.txt").trim()).toBe(license);
  });

  it("axe.min.js is unchanged, keeps its MPL-2.0 notice", () => {
    const v = read("vendor/axe.min.js");
    expect(v.endsWith(axeSource())).toBe(true);
    expect(v.split("\n")[0]).toBe(`// GENERATED copy of axe-core@${AXE_CORE_VERSION} axe.min.js — MPL-2.0 — do not edit.`);
    expect(v).toContain("Mozilla Public");
    expect(v).toContain("This entire copyright notice must appear in every copy of this file");
  });

  it("the vendored files load through the wrappers without touching page globals", () => {
    const w = makeWindow("");
    w.eval("var ace = 'page-ace'; window.axe = 'page-axe';");
    expect(w.eval(wrapAceSource(read("vendor/ibm-ace.js")))).toBe(IBM_ACE_VERSION);
    expect(w.eval(wrapAxeSource(read("vendor/axe.min.js")))).toBe(AXE_CORE_VERSION);
    expect(w.ace).toBe("page-ace");
    expect(w.axe).toBe("page-axe");
  });

  it("ships the notices and the panel modules", () => {
    const notices = read("THIRD_PARTY_NOTICES.txt");
    for (const s of ["Apache License", "Mozilla Public License", "MIT", "axe-core", "equal-access", "a11yinspect"]) expect(notices).toContain(s);
    expect(read("vendor/a11y-rules.mjs")).toContain("mergeA11yReports");
    expect(read("vendor/a11y-audit.js")).toContain("__PERF_INTEL_A11Y__");
  });
});
