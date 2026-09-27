import { describe, expect, it } from "vitest";
import { WCAG_CRITERIA, criteriaForStandard, criterionInStandard, normalizeStandard, standardLabel, wcagUnderstandingUrl, type WcagVersion } from "../wcag.js";

describe("WCAG criteria table", () => {
  it("has all 87 criteria of WCAG 2.0 / 2.1 / 2.2", () => {
    expect(WCAG_CRITERIA).toHaveLength(87);
    const count = (version: WcagVersion, level: string) => criteriaForStandard(normalizeStandard({ version, level })).length;
    expect(count("2.0", "A")).toBe(25);
    expect(count("2.0", "AA")).toBe(38);
    expect(count("2.0", "AAA")).toBe(61);
    expect(count("2.1", "AA")).toBe(50);
    expect(count("2.1", "AAA")).toBe(78);
    expect(count("2.2", "AA")).toBe(55); // 4.1.1 Parsing is obsolete in 2.2
    expect(count("2.2", "AAA")).toBe(86);
  });

  it("scopes criteria by version and level", () => {
    const s22 = normalizeStandard({ version: "2.2", level: "AA" });
    expect(criterionInStandard("2.5.8", s22)).toBe(true);
    expect(criterionInStandard("2.5.8", normalizeStandard({ version: "2.1" }))).toBe(false);
    expect(criterionInStandard("4.1.1", s22)).toBe(false);
    expect(criterionInStandard("4.1.1", normalizeStandard({ version: "2.1" }))).toBe(true);
    expect(criterionInStandard("1.4.6", s22)).toBe(false);
  });

  it("normalizes standards and profiles", () => {
    expect(normalizeStandard(null)).toEqual({ profile: "wcag", version: "2.2", level: "AA", bestPractices: true, includeReview: true });
    expect(normalizeStandard({ profile: "section508", version: "2.2", level: "AAA" })).toMatchObject({ version: "2.0", level: "AA" });
    expect(normalizeStandard({ profile: "en301549" })).toMatchObject({ version: "2.1", level: "AA" });
    expect(normalizeStandard({ version: "3.0", level: "X", bestPractices: "yes" })).toMatchObject({ version: "2.2", level: "AA", bestPractices: true });
    expect(standardLabel(normalizeStandard({ version: "2.1", level: "A" }))).toBe("WCAG 2.1 · A");
    expect(standardLabel(normalizeStandard({ profile: "en301549" }))).toBe("EN 301 549");
  });

  it("links to W3C Understanding documents", () => {
    expect(wcagUnderstandingUrl("1.4.3")).toBe("https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html");
    expect(wcagUnderstandingUrl("3.3.4")).toBe("https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html");
    expect(wcagUnderstandingUrl("4.1.2")).toBe("https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html");
    expect(wcagUnderstandingUrl("9.9.9")).toBe("https://www.w3.org/WAI/WCAG22/quickref/");
  });
});
