# Security policy

## Supported versions

Security fixes go into the latest minor release of the npm package `performance-engine` and the
latest version of the Perf Intelligence DevTools extension.

| Version | Supported |
|---------|-----------|
| 0.4.x | Yes |
| < 0.4 | No |

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through
[GitHub private vulnerability reporting](https://github.com/ezhillragesh/performance-engine/security/advisories/new)
(Security → Advisories → "Report a vulnerability").

Please include the affected component (core, extension or demo), the version, the steps to reproduce,
and the impact you expect. You can expect an acknowledgement within 7 days and an assessment within
14 days. Once a fix is released we publish an advisory and credit you, unless you prefer otherwise.

## Scope and threat model

The design is described in [ARCHITECTURE.md, "Security and privacy model"](./docs/ARCHITECTURE.md#13-security-and-privacy-model).
Reports that are especially relevant:

- **Panel injection**: page-controlled data (insight strings, URLs, component names, accessibility
  snippets) that is rendered as HTML or executed in the DevTools panel. The panel must render page
  data as text only, and every payload passes `extension/devtools/panel/validate.js`.
- **Message spoofing**: a page, an iframe or another extension driving the service worker in a way it
  should not, for example enabling injection for an origin the user did not approve, or reading
  another tab's state.
- **Privilege escalation**: anything that grants host access beyond the per-origin optional permission
  the user approved, or keeps an injection registered after the permission is revoked.
- **PII leakage**: form values, input or `contenteditable` text, URL query values or free page text
  ending up in events, insights, accessibility findings or exports.
- **Host-app breakage**: instrumentation that throws into, or materially slows down, the host page
  (for example through the `fetch`/XHR patches or the React DevTools hook).

Out of scope: issues that need a malicious extension already installed with broader permissions,
self-XSS in the browser console, and findings in the vendored third-party engines
(`extension/vendor/ibm-ace.js`, `axe.min.js`). Report those upstream; we ship them unchanged and will
update the pinned version.
