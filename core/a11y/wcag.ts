// WCAG 2.0 / 2.1 / 2.2 success criteria (all levels) and the audit "standard" selection
// (WCAG version x conformance level, or a Section 508 / EN 301 549 profile).
// Static data, no DOM access: shared by the page bundle, the DevTools panel and the demo.
import type { A11yLevel } from "./types.js";

export type WcagVersion = "2.0" | "2.1" | "2.2";

export interface WcagCriterion {
  /** e.g. "1.4.3" */
  num: string;
  name: string;
  level: A11yLevel;
  /** WCAG version that introduced the criterion. */
  version: WcagVersion;
  /** Removed from this version on (only 4.1.1 Parsing, obsolete in WCAG 2.2). */
  obsoleteIn?: WcagVersion;
}

// [num, name, level, version introduced]
const RAW: Array<[string, string, A11yLevel, WcagVersion]> = [
  ["1.1.1", "Non-text Content", "A", "2.0"],
  ["1.2.1", "Audio-only and Video-only (Prerecorded)", "A", "2.0"],
  ["1.2.2", "Captions (Prerecorded)", "A", "2.0"],
  ["1.2.3", "Audio Description or Media Alternative (Prerecorded)", "A", "2.0"],
  ["1.2.4", "Captions (Live)", "AA", "2.0"],
  ["1.2.5", "Audio Description (Prerecorded)", "AA", "2.0"],
  ["1.2.6", "Sign Language (Prerecorded)", "AAA", "2.0"],
  ["1.2.7", "Extended Audio Description (Prerecorded)", "AAA", "2.0"],
  ["1.2.8", "Media Alternative (Prerecorded)", "AAA", "2.0"],
  ["1.2.9", "Audio-only (Live)", "AAA", "2.0"],
  ["1.3.1", "Info and Relationships", "A", "2.0"],
  ["1.3.2", "Meaningful Sequence", "A", "2.0"],
  ["1.3.3", "Sensory Characteristics", "A", "2.0"],
  ["1.3.4", "Orientation", "AA", "2.1"],
  ["1.3.5", "Identify Input Purpose", "AA", "2.1"],
  ["1.3.6", "Identify Purpose", "AAA", "2.1"],
  ["1.4.1", "Use of Color", "A", "2.0"],
  ["1.4.2", "Audio Control", "A", "2.0"],
  ["1.4.3", "Contrast (Minimum)", "AA", "2.0"],
  ["1.4.4", "Resize Text", "AA", "2.0"],
  ["1.4.5", "Images of Text", "AA", "2.0"],
  ["1.4.6", "Contrast (Enhanced)", "AAA", "2.0"],
  ["1.4.7", "Low or No Background Audio", "AAA", "2.0"],
  ["1.4.8", "Visual Presentation", "AAA", "2.0"],
  ["1.4.9", "Images of Text (No Exception)", "AAA", "2.0"],
  ["1.4.10", "Reflow", "AA", "2.1"],
  ["1.4.11", "Non-text Contrast", "AA", "2.1"],
  ["1.4.12", "Text Spacing", "AA", "2.1"],
  ["1.4.13", "Content on Hover or Focus", "AA", "2.1"],
  ["2.1.1", "Keyboard", "A", "2.0"],
  ["2.1.2", "No Keyboard Trap", "A", "2.0"],
  ["2.1.3", "Keyboard (No Exception)", "AAA", "2.0"],
  ["2.1.4", "Character Key Shortcuts", "A", "2.1"],
  ["2.2.1", "Timing Adjustable", "A", "2.0"],
  ["2.2.2", "Pause, Stop, Hide", "A", "2.0"],
  ["2.2.3", "No Timing", "AAA", "2.0"],
  ["2.2.4", "Interruptions", "AAA", "2.0"],
  ["2.2.5", "Re-authenticating", "AAA", "2.0"],
  ["2.2.6", "Timeouts", "AAA", "2.1"],
  ["2.3.1", "Three Flashes or Below Threshold", "A", "2.0"],
  ["2.3.2", "Three Flashes", "AAA", "2.0"],
  ["2.3.3", "Animation from Interactions", "AAA", "2.1"],
  ["2.4.1", "Bypass Blocks", "A", "2.0"],
  ["2.4.2", "Page Titled", "A", "2.0"],
  ["2.4.3", "Focus Order", "A", "2.0"],
  ["2.4.4", "Link Purpose (In Context)", "A", "2.0"],
  ["2.4.5", "Multiple Ways", "AA", "2.0"],
  ["2.4.6", "Headings and Labels", "AA", "2.0"],
  ["2.4.7", "Focus Visible", "AA", "2.0"],
  ["2.4.8", "Location", "AAA", "2.0"],
  ["2.4.9", "Link Purpose (Link Only)", "AAA", "2.0"],
  ["2.4.10", "Section Headings", "AAA", "2.0"],
  ["2.4.11", "Focus Not Obscured (Minimum)", "AA", "2.2"],
  ["2.4.12", "Focus Not Obscured (Enhanced)", "AAA", "2.2"],
  ["2.4.13", "Focus Appearance", "AAA", "2.2"],
  ["2.5.1", "Pointer Gestures", "A", "2.1"],
  ["2.5.2", "Pointer Cancellation", "A", "2.1"],
  ["2.5.3", "Label in Name", "A", "2.1"],
  ["2.5.4", "Motion Actuation", "A", "2.1"],
  ["2.5.5", "Target Size (Enhanced)", "AAA", "2.1"],
  ["2.5.6", "Concurrent Input Mechanisms", "AAA", "2.1"],
  ["2.5.7", "Dragging Movements", "AA", "2.2"],
  ["2.5.8", "Target Size (Minimum)", "AA", "2.2"],
  ["3.1.1", "Language of Page", "A", "2.0"],
  ["3.1.2", "Language of Parts", "AA", "2.0"],
  ["3.1.3", "Unusual Words", "AAA", "2.0"],
  ["3.1.4", "Abbreviations", "AAA", "2.0"],
  ["3.1.5", "Reading Level", "AAA", "2.0"],
  ["3.1.6", "Pronunciation", "AAA", "2.0"],
  ["3.2.1", "On Focus", "A", "2.0"],
  ["3.2.2", "On Input", "A", "2.0"],
  ["3.2.3", "Consistent Navigation", "AA", "2.0"],
  ["3.2.4", "Consistent Identification", "AA", "2.0"],
  ["3.2.5", "Change on Request", "AAA", "2.0"],
  ["3.2.6", "Consistent Help", "A", "2.2"],
  ["3.3.1", "Error Identification", "A", "2.0"],
  ["3.3.2", "Labels or Instructions", "A", "2.0"],
  ["3.3.3", "Error Suggestion", "AA", "2.0"],
  ["3.3.4", "Error Prevention (Legal, Financial, Data)", "AA", "2.0"],
  ["3.3.5", "Help", "AAA", "2.0"],
  ["3.3.6", "Error Prevention (All)", "AAA", "2.0"],
  ["3.3.7", "Redundant Entry", "A", "2.2"],
  ["3.3.8", "Accessible Authentication (Minimum)", "AA", "2.2"],
  ["3.3.9", "Accessible Authentication (Enhanced)", "AAA", "2.2"],
  ["4.1.1", "Parsing", "A", "2.0"],
  ["4.1.2", "Name, Role, Value", "A", "2.0"],
  ["4.1.3", "Status Messages", "AA", "2.1"],
];

/** Every success criterion of WCAG 2.0, 2.1 and 2.2 (87; WCAG 2.2 itself has 86). */
export const WCAG_CRITERIA: readonly WcagCriterion[] = RAW.map(([num, name, level, version]) =>
  num === "4.1.1" ? { num, name, level, version, obsoleteIn: "2.2" as WcagVersion } : { num, name, level, version },
);

const BY_NUM = new Map(WCAG_CRITERIA.map((c) => [c.num, c]));
const VERSION_RANK: Record<WcagVersion, number> = { "2.0": 0, "2.1": 1, "2.2": 2 };
const LEVEL_RANK: Record<A11yLevel, number> = { A: 0, AA: 1, AAA: 2 };

export function wcagCriterion(num: string): WcagCriterion | undefined {
  return BY_NUM.get(num);
}

/** "Contrast (Minimum)" -> "contrast-minimum" (the W3C Understanding document slug). */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[(),]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** W3C "Understanding WCAG 2.2" link for a criterion (the quick reference when unknown). */
export function wcagUnderstandingUrl(num: string): string {
  const c = BY_NUM.get(num);
  return c ? `https://www.w3.org/WAI/WCAG22/Understanding/${slug(c.name)}.html` : "https://www.w3.org/WAI/WCAG22/quickref/";
}

// ── Standards ──

export type A11yStandardProfile = "wcag" | "section508" | "en301549";

/** What the audit checks against. Section 508 (2017 refresh) = WCAG 2.0 A+AA; EN 301 549 v3.2.1 = WCAG 2.1 A+AA. */
export interface A11yStandard {
  profile: A11yStandardProfile;
  version: WcagVersion;
  level: A11yLevel;
  /** Include rules that are not tied to a WCAG success criterion. */
  bestPractices: boolean;
  /** Include "needs review" findings (possible issues a person must confirm). */
  includeReview: boolean;
}

export const DEFAULT_A11Y_STANDARD: Readonly<A11yStandard> = Object.freeze({
  profile: "wcag",
  version: "2.2",
  level: "AA",
  bestPractices: true,
  includeReview: true,
});

/** Validates / completes an untrusted standard object; profiles pin their WCAG version and level. */
export function normalizeStandard(raw?: unknown): A11yStandard {
  const d = DEFAULT_A11Y_STANDARD;
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const profile: A11yStandardProfile = o.profile === "section508" || o.profile === "en301549" ? o.profile : "wcag";
  let version: WcagVersion = o.version === "2.0" || o.version === "2.1" || o.version === "2.2" ? o.version : d.version;
  let level: A11yLevel = o.level === "A" || o.level === "AA" || o.level === "AAA" ? o.level : d.level;
  if (profile === "section508") {
    version = "2.0";
    level = "AA";
  } else if (profile === "en301549") {
    version = "2.1";
    level = "AA";
  }
  return {
    profile,
    version,
    level,
    bestPractices: typeof o.bestPractices === "boolean" ? o.bestPractices : d.bestPractices,
    includeReview: typeof o.includeReview === "boolean" ? o.includeReview : d.includeReview,
  };
}

export function standardLabel(s: A11yStandard): string {
  if (s.profile === "section508") return "Section 508";
  if (s.profile === "en301549") return "EN 301 549";
  return `WCAG ${s.version} · ${s.level}`;
}

/** True when the criterion belongs to the standard's WCAG version and is at or below its level. */
export function criterionInStandard(num: string, s: A11yStandard): boolean {
  const c = BY_NUM.get(num);
  if (!c) return false;
  if (VERSION_RANK[c.version] > VERSION_RANK[s.version]) return false;
  if (c.obsoleteIn && VERSION_RANK[s.version] >= VERSION_RANK[c.obsoleteIn]) return false;
  return LEVEL_RANK[c.level] <= LEVEL_RANK[s.level];
}

/** Success criteria of the standard, in document order. */
export function criteriaForStandard(s: A11yStandard): WcagCriterion[] {
  return WCAG_CRITERIA.filter((c) => criterionInStandard(c.num, s));
}

export function levelRank(level: A11yLevel): number {
  return LEVEL_RANK[level];
}
