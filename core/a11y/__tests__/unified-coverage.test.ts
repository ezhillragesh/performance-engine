// Every source rule / check of all three engines maps to exactly one unified rule.
// After upgrading an engine, this test lists the ids that need a home in catalog/unified.ts.
import { describe, expect, it } from "vitest";
import { IGNORED_SOURCES, UNIFIED_RULES } from "../catalog/unified.js";
import { allCheckMeta } from "../meta.js";
import { WCAG_CRITERIA } from "../wcag.js";
import { installAce, installAxe, makeWindow } from "./engines.js";

interface EngineInternals {
  Checker: new () => { engine: { getRulesIds(): string[] } };
}

function sourceIds(): { a11yinspect: string[]; ibm: string[]; axe: string[] } {
  const w = makeWindow("");
  const ace = installAce(w) as unknown as EngineInternals;
  const axe = installAxe(w);
  return {
    a11yinspect: allCheckMeta().map((m) => `a11yinspect:${m.ruleId}/${m.check}`),
    ibm: new ace.Checker().engine.getRulesIds().map((id) => `ibm:${id}`),
    axe: axe.getRules().map((r) => `axe:${r.ruleId}`),
  };
}

describe("unified rule catalog", () => {
  const ids = sourceIds();
  const mapped = new Map<string, string[]>();
  for (const r of UNIFIED_RULES) for (const s of r.sources) mapped.set(s, [...(mapped.get(s) ?? []), r.id]);

  it("covers the expected source sets", () => {
    expect(ids.a11yinspect).toHaveLength(227);
    expect(ids.ibm.length).toBeGreaterThanOrEqual(170);
    expect(ids.axe.length).toBeGreaterThanOrEqual(100);
  });

  for (const engine of ["a11yinspect", "ibm", "axe"] as const) {
    it(`maps every ${engine} source id to exactly one unified rule`, () => {
      const unmapped = ids[engine].filter((id) => !mapped.has(id) && !IGNORED_SOURCES.includes(id));
      const multi = ids[engine].filter((id) => (mapped.get(id)?.length ?? 0) > 1);
      expect({ unmapped, multi }).toEqual({ unmapped: [], multi: [] });
    });
  }

  it("has no stale source ids (every catalog source exists in the installed engines)", () => {
    const known = new Set([...ids.a11yinspect, ...ids.ibm, ...ids.axe]);
    const stale = [...mapped.keys()].filter((s) => !known.has(s));
    expect(stale).toEqual([]);
    expect(IGNORED_SOURCES.filter((s) => !known.has(s))).toEqual([]);
  });

  it("has unique ids, own wording and valid WCAG references", () => {
    const seen = new Set<string>();
    const nums = new Set(WCAG_CRITERIA.map((c) => c.num));
    for (const r of UNIFIED_RULES) {
      expect(seen.has(r.id), r.id).toBe(false);
      seen.add(r.id);
      expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(r.title.length, r.id).toBeGreaterThan(8);
      expect(r.help.length, r.id).toBeGreaterThan(8);
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      // Our own wording: no engine / vendor names in user-facing text.
      for (const text of [r.title, r.description, r.help]) expect(text, r.id).not.toMatch(/\b(axe|ibm|deque|a11yinspect|barrierbreak|equal access)\b/i);
      for (const w of r.wcag) expect(nums.has(w.criterion), `${r.id} ${w.criterion}`).toBe(true);
      expect(r.wcag.length === 0, r.id).toBe(r.tags.includes("best-practice"));
    }
  });

  it("reports mapping numbers", () => {
    const total = ids.a11yinspect.length + ids.ibm.length + ids.axe.length;
    const multiSource = UNIFIED_RULES.filter((r) => new Set(r.sources.map((s) => s.split(":")[0])).size > 1).length;
    console.info(`[unified] ${UNIFIED_RULES.length} rules from ${total} source ids (A11yInspect ${ids.a11yinspect.length} checks, IBM ${ids.ibm.length} rules incl. ${IGNORED_SOURCES.length} ignored, axe ${ids.axe.length} rules); ${multiSource} rules merge several engines`);
    expect(UNIFIED_RULES.length).toBeGreaterThan(100);
  });
});
