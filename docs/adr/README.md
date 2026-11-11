# Architecture Decision Records

Short records of the decisions that shape this codebase: what was decided, why, and what it costs.
They were written down retroactively for 0.4.0, from the design as implemented. New significant
decisions get a new record.

| ADR | Title | Status |
|-----|-------|--------|
| [0001](./0001-stamp-trace-at-capture.md) | Stamp the trace at capture time and never infer it by time | Accepted |
| [0002](./0002-evidence-based-confidence.md) | Derive insight confidence from measured evidence | Accepted |
| [0003](./0003-bounded-in-memory-store.md) | Keep a bounded, in-memory, append-only event store | Accepted |
| [0004](./0004-rdt-compatible-react-hook.md) | Instrument React through an RDT-compatible DevTools hook | Accepted |
| [0005](./0005-attach-gated-streaming.md) | Stream to DevTools only while a panel is attached | Accepted |
| [0006](./0006-no-build-extension-with-vendored-bundles.md) | Keep the extension build-free with checked-in generated bundles | Accepted |
| [0007](./0007-unified-a11y-rule-set.md) | Present three accessibility engines as one unified rule set | Accepted |
| [0008](./0008-engine-modes-and-app-wins-handoff.md) | Support three engine modes, and let the app engine win | Accepted |
| [0009](./0009-privacy-by-construction.md) | Privacy by construction: no PII in events, findings or exports | Accepted |

## Writing a new record

Copy [`template.md`](./template.md) to `NNNN-short-title.md` with the next number, keep it to about
one page, and link it from the table above and from the relevant section of
[`ARCHITECTURE.md`](../ARCHITECTURE.md). A record is never rewritten after it is accepted. To change a
decision, add a new record and mark the old one `Superseded by NNNN`.
