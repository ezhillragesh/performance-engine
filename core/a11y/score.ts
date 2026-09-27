// Counts and score of a finding list (dependency-free: shared by the engines and the merge).
import type { A11yCounts, A11yFinding, A11yImpact, A11yKind } from "./types.js";

const IMPACT_WEIGHT: Record<A11yImpact, number> = { critical: 10, major: 5, minor: 2, info: 0.5 };

export function emptyCounts(): A11yCounts {
  return { errors: 0, warnings: 0, reviews: 0, byImpact: { critical: 0, major: 0, minor: 0, info: 0 }, byWcag: {} };
}

/** Error, review, warning weights in the score (a "needs review" item is only a possible failure). */
const KIND_WEIGHT: Record<A11yKind, number> = { error: 1, warning: 0.6, review: 0.25 };

/** Recomputes the counts of a finding list. */
export function countFindings(findings: readonly A11yFinding[]): A11yCounts {
  const counts = emptyCounts();
  for (const f of findings) {
    if (f.kind === "error") counts.errors++;
    else if (f.kind === "review") counts.reviews++;
    else counts.warnings++;
    counts.byImpact[f.impact]++;
    if (f.wcag) counts.byWcag[f.wcag] = (counts.byWcag[f.wcag] || 0) + 1;
  }
  return counts;
}

/**
 * 100 = clean. Each distinct check costs its impact weight (warnings 60%, needs-review 25%),
 * growing with log2 of instances. In a unified report (findings with `sources`) a check is a unified
 * rule: its `check` is only the first source's, which depends on which engine reported first.
 */
export function computeScore(findings: readonly A11yFinding[]): number {
  const groups = new Map<string, { f: A11yFinding; n: number }>();
  for (const f of findings) {
    const k = f.sources ? f.ruleId : `${f.ruleId}/${f.check}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { f, n: 1 });
  }
  let penalty = 0;
  for (const { f, n } of groups.values()) {
    penalty += IMPACT_WEIGHT[f.impact] * (KIND_WEIGHT[f.kind] ?? 0.6) * (1 + Math.log2(n) / 2);
  }
  return Math.max(0, Math.min(100, Math.round(100 * Math.exp(-penalty / 60))));
}

