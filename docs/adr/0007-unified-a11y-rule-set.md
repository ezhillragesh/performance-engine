# 0007. Present three accessibility engines as one unified rule set

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively)

## Context

No single automated accessibility engine covers everything. Our runtime port of eslint-plugin-a11yinspect
is fast and has computed names and real visibility. IBM Equal Access and axe-core bring ACT-harmonised
rules, colour contrast, shadow DOM and frames. Run side by side, they report the same problem two or
three times, each with different wording, severity scales and element descriptions (a CSS path, an
XPath, axe's `host >>> inner`). Showing three lists, or naming engines, would push the work of
deduplication onto the user. Their message strings can also contain page text.

## Decision

- The UI (panel and demo) shows **one rule set**, `core/a11y/catalog/unified.ts` (174 rules), with our
  own titles, help, WCAG criteria and tags. Engines are internal and **never named in the UI**. Only
  `THIRD_PARTY_NOTICES` credits them.
- IBM and axe are vendored **unchanged** from pinned exact devDependencies, loaded wrapped so page
  globals are never clobbered, and never hand-ported or edited. Upgrades follow a documented procedure,
  and `unified-coverage.test.ts` lists new or stale source ids.
- Each adapter emits engine-level findings with an element identity: `node` (a per-page key), `pos`
  (composed-tree position) and one canonical selector (ours). `mergeA11yReports` (`a11y/unify.ts`)
  dedupes **by element identity, never by selector strings**, and collapses duplicates through
  explicit policy tables (`PAGE_RULES`, `SUBSUMED_BY`, `NESTED_POLICY`, `NESTED_INTO`, `REFINE`,
  `CHECK_REFINE`).
- Origins are kept in hidden `sources` for exports and debugging, and never rendered.

## Consequences

- Users get one finding per element and problem, in consistent language, filtered by the standard
  they choose (WCAG 2.0, 2.1 or 2.2 at A, AA or AAA, Section 508, EN 301 549).
- Every new duplicate pair needs a policy-table entry and a regression test in `dedupe.test.ts`, which
  makes the merge a maintained component.
- Engine upgrades require mapping new source ids. Unmapped ids still work at runtime and fall back to
  the rule "other".
- The vendored engines are large (about 0.6 MB each) and are loaded only on demand, in the panel and
  as lazy chunks in the demo.

## Alternatives considered

- **One engine only**: smaller, but weaker coverage, and the choice would be arbitrary.
- **Separate tabs per engine**: honest, but the user does the deduplication.
- **Dedupe by selector string**: the same element has different selectors in each engine (and through
  shadow roots and frames), so this misses duplicates and merges distinct elements.
- **Hand-porting the IBM and axe rules**: a fork to maintain forever, and the licence obligations grow.
