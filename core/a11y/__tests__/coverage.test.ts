// Every messageId in the downloaded a11yinspect sources is ported and has a fixture that triggers it.
import { describe, expect, it } from "vitest";
import { CATALOG } from "../catalog.js";
import { listRuleIds } from "../engine.js";
import { allCheckMeta } from "../meta.js";
import { TRIGGERS } from "./fixtures.js";
import { audit, has } from "./helpers.js";
import { SOURCE_MESSAGE_IDS, SOURCE_RULE_IDS } from "./sourceMessageIds.js";

describe("source coverage", () => {
  it("ports every source rule id 1:1", () => {
    expect([...listRuleIds()].sort()).toEqual([...SOURCE_RULE_IDS].sort());
    expect(SOURCE_RULE_IDS.length).toBe(89);
  });

  it("catalogs every source messageId (and nothing else)", () => {
    const catalogIds = Object.entries(CATALOG).flatMap(([r, m]) => Object.keys(m).map((c) => `${r}/${c}`));
    expect(catalogIds.sort()).toEqual([...SOURCE_MESSAGE_IDS].sort());
    expect(SOURCE_MESSAGE_IDS.length).toBe(227);
  });

  it("keeps severity tag, kind, WCAG criterion and level for every check", () => {
    for (const m of allCheckMeta()) {
      expect(m.message).not.toMatch(/[❌⚠️💡]/u);
      expect(m.message).toMatch(/^\[(Blocker|Critical|Major|Minor|Best Practice)\] /);
      expect(m.wcag).toMatch(/^\d\.\d\.\d$/);
      expect(m.level === "A" || m.level === "AA" || m.level === "AAA").toBe(true);
      expect(m.kind).toBe(m.ruleId.endsWith("-warning") ? "warning" : "error");
      expect(m.help.length).toBeGreaterThan(10);
    }
  });

  it("has a triggering fixture for every source messageId", () => {
    const missing = SOURCE_MESSAGE_IDS.filter((id) => !(id in TRIGGERS));
    expect(missing).toEqual([]);
  });

  for (const id of SOURCE_MESSAGE_IDS) {
    it(`triggers ${id}`, () => {
      const fx = TRIGGERS[id];
      expect(fx, `fixture for ${id}`).toBeDefined();
      const r = audit(fx);
      expect(r.error).toBeUndefined();
      expect(has(r, id), `${id} not reported; got ${r.findings.map((f) => f.ruleId + "/" + f.check).join(", ")}`).toBe(true);
    });
  }
});
