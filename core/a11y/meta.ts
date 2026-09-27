// Parses the catalog message text into structured metadata (severity tag, impact, WCAG, level).
import { CATALOG } from "./catalog.js";
import type { A11yImpact, A11yKind, A11yLevel, A11ySeverityTag } from "./types.js";

export interface CheckMeta {
  ruleId: string;
  check: string;
  kind: A11yKind;
  severity: A11ySeverityTag;
  impact: A11yImpact;
  wcag: string;
  level: A11yLevel | null;
  message: string;
  help: string;
}

const IMPACT_BY_TAG: Record<A11ySeverityTag, A11yImpact> = {
  Blocker: "critical",
  Critical: "critical",
  Major: "major",
  Minor: "minor",
  "Best Practice": "info",
};

function parse(ruleId: string, check: string, message: string, help: string): CheckMeta {
  const tagMatch = /^\[([^\]]+)\]/.exec(message);
  const tag = (tagMatch ? tagMatch[1] : "Minor") as A11ySeverityTag;
  const wc = /\((\d+\.\d+\.\d+)\s+(A{1,3})\)\s*$/.exec(message);
  return {
    ruleId,
    check,
    kind: ruleId.endsWith("-warning") ? "warning" : "error",
    severity: tag in IMPACT_BY_TAG ? tag : "Minor",
    impact: IMPACT_BY_TAG[tag] ?? "minor",
    wcag: wc ? wc[1] : "",
    level: wc ? (wc[2] as A11yLevel) : null,
    message,
    help,
  };
}

const META = new Map<string, CheckMeta>();
for (const ruleId of Object.keys(CATALOG)) {
  const checks = CATALOG[ruleId];
  for (const check of Object.keys(checks)) {
    const [message, help] = checks[check];
    META.set(`${ruleId}/${check}`, parse(ruleId, check, message, help));
  }
}

export function checkMeta(ruleId: string, check: string): CheckMeta | undefined {
  return META.get(`${ruleId}/${check}`);
}

export function allCheckMeta(): CheckMeta[] {
  return [...META.values()];
}

export function ruleKind(ruleId: string): A11yKind {
  return ruleId.endsWith("-warning") ? "warning" : "error";
}
