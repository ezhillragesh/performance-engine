# 0009. Privacy by construction: no PII in events, findings or exports

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively)

## Context

The engine and the audit run on real pages, sometimes the user's own production sites with real
customer data. Snapshots are exported, attached to bug reports and shared. A diagnosis tool that
captures form input, URL tokens or page text becomes a data-leak vector, and filtering after capture
is easy to get wrong.

## Decision

Sensitive data is never captured in the first place, rather than redacted later:

- **Network**: URLs are reduced by `sanitizeUrl` to the path plus query parameter *names*. Values are
  dropped, and `data:` and `blob:` URLs become their scheme only.
- **UI events**: a target descriptor and a short label (60 characters at most). Form field values and
  `contenteditable` text are never read.
- **Accessibility findings**: rule ids, a CSS path (ids, tag names and `:nth-of-type` only, or our XPath
  for shadow and frame nodes) and a redacted opening-tag snippet (value-like attributes redacted, URL
  queries stripped, IBM and axe snippets regenerated from the live element). Vendor messages and
  message arguments are never used, and `detail` is non-PII context such as an attribute name or a
  contrast ratio. The single exception is `name`, a preview of what the element says (60 characters
  at most), which is empty for form fields, options, anything inside or containing a field or
  `contenteditable`, the page root and large containers.
- **Transport**: there is no backend and no telemetry egress. Page payloads are untrusted, validated in
  `devtools/panel/validate.js`, and rendered as text only.

## Consequences

- Exports can be shared with far less risk, and the extension's privacy statement is simple.
- Some diagnoses are less specific: a slow request is identified by path and parameter names, not by
  the exact query.
- New trackers, fields or adapters must follow the same rules. PII redaction has tests in the a11y
  suite and in `network.test.ts`.

## Alternatives considered

- **Capture everything, redact on export**: one missed path leaks, and data sits in memory and session
  storage in the meantime.
- **Configurable capture levels**: more surface to get wrong, for little diagnostic gain.
