# 0002. Derive insight confidence from measured evidence

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively)

## Context

v0.1 rules set `confidence` by hand. The numbers could not be explained to a user ("why 0.8?") and
could not be tested meaningfully. Users of a diagnosis tool need to see *why* it believes something,
and the panel needs something to highlight in the timeline.

## Decision

- Every `Insight` carries `evidence[]`. Each item is a measured value with its unit, the threshold it
  was compared with, the `eventIds` it came from and a `weight` (`core/types/insights.ts`).
- `confidence = 1 − Π(1 − weightᵢ)` (noisy-OR), capped at 0.98 (`confidenceFromEvidence` in
  `analyzer/rules/shared.ts`). Weights grow with how far a value exceeds its threshold (`scaledWeight`).
- Severity comes from measured magnitude (INP-style latency bands, and ratio bands relative to the
  threshold), not from the rule's opinion.
- An insight's `id` is anchored on its trigger or first event, so it stays stable while its window
  grows, and the merge keeps the earliest id.

## Consequences

- The panel can show an evidence list with threshold bars and highlight the evidence events on the
  timeline.
- Tests assert evidence and confidence, not just the presence of an insight.
- More evidence always raises confidence, so rules must not pad the list with weak or duplicate items.
- Custom rules that omit evidence still work: the engine normalises them to an empty list, and their
  confidence is clamped.

## Alternatives considered

- **Hand-set confidence per rule**: unexplainable and untestable.
- **A trained or statistical model**: no labelled data, opaque to users, and heavy for an in-page library.
