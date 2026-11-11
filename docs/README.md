# Documentation

Start with the [root README](../README.md) for what the project does and the quick starts. This page
lists every document and which one is authoritative for what.

## Design

| Document | What it covers |
|----------|----------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The main design document: goals, components, data flow, the trace model, the analysis pipeline, confidence, budgets, memory and overhead, React instrumentation, the accessibility pipeline, extension internals, security and privacy, testing, extension points, limitations |
| [adr/](./adr/README.md) | Architecture Decision Records: why the key decisions were made, and what they cost |

## Contracts (authoritative, kept in sync with code)

| Document | What it covers |
|----------|----------------|
| [CORE_API.md](./CORE_API.md) | Public API of the npm package `performance-engine` (`core/index.ts`) |
| [PROTOCOL.md](./PROTOCOL.md) | Messages between page, content script, service worker and panel. Engine modes and handoff, the DevTools-only layer, the accessibility audit wire format, export bundles |
| [`core/types/`](../core/types) | TypeScript types for events, insights, budgets, summaries and the protocol |

## Per package

| Document | What it covers |
|----------|----------------|
| [core/README.md](../core/README.md) | The npm package README |
| [EXTENSION.md](./EXTENSION.md) | Extension user guide: install, the three modes, site access, the toolbar popup, panel views, troubleshooting, developing the extension |
| [PRIVACY.md](./PRIVACY.md) | Extension privacy policy: what it reads, what it stores and for how long, what never leaves the browser, why each permission is needed |
| [demo/README.md](../demo/README.md) | The demo: scenarios, mock API transports, static hosting, end-to-end tests |

## Project

| Document | What it covers |
|----------|----------------|
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, gates, conventions, recipes (rules, a11y rules, panel views, demo scenarios), commits, release process |
| [AGENTS.md](../AGENTS.md) | Condensed invariants and commands, also used as the brief for coding agents |
| [CHANGELOG.md](../CHANGELOG.md) | Release history |
| [SECURITY.md](../SECURITY.md) | Supported versions, private reporting, threat model |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1 |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | Licences of the accessibility engines the audit builds on |

When code and a document disagree, the contracts above win. Fix the document in the same change.
