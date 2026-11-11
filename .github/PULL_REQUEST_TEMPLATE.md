## What and why

<!-- One or two sentences. Link the issue: Fixes #123 -->

## Subsystems touched

- [ ] `core/` (engine, analyzer, a11y)
- [ ] `extension/` (DevTools panel, service worker, content script)
- [ ] `demo/`
- [ ] docs / repo tooling

## Checklist

- [ ] `npm run check` passes at the repo root (or the per-package gates in CONTRIBUTING.md)
- [ ] Core fix: a regression test is added. New rule: positive **and** negative tests
- [ ] Core change: `cd core && npm run build:extension` was run and `extension/vendor/` is committed
- [ ] Contracts updated if behaviour changed: `docs/PROTOCOL.md`, `docs/CORE_API.md`, `core/types/*`, `devtools/panel/validate.js`
- [ ] No PII: no form values, input text, page text or URL query values in events, findings or exports
- [ ] Demo change: `cd demo && npm run e2e` passes, and a new Scenario Lab card is added to `e2e/scenarios.spec.ts`
- [ ] Extension UI checked in `extension/dev/preview.html` / `popup-preview.html` (light and dark) or in Chrome
- [ ] Extension reads or stores something new: `docs/PRIVACY.md` updated
- [ ] `CHANGELOG.md` updated in the top (unreleased) section for user-visible changes
- [ ] The PR title follows Conventional Commits (`feat(core): …`, `fix(extension): …`)

## Screenshots / evidence

<!-- Panel screenshots, insight JSON, timings. Delete if not applicable. -->
