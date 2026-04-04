export type IssueType =
  | "interaction-induced-render-burst"
  | "keystroke-render-loop"
  | "interaction-render-latency"
  | "network-blocking-render";

export type InsightSeverity = "low" | "medium" | "high";

export interface Insight {
  issueType: IssueType;
  message: string;
  cause: string;
  possibleFix: string;
  severity: InsightSeverity;
  source: string;
}
