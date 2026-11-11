# Contributing

Thanks for helping. This guide covers setup, the gates every change must pass, the conventions that
keep the system trustworthy, and step-by-step recipes for the common changes. The design is described
in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md). The full list of invariants, which is also the
brief for coding agents, is [`AGENTS.md`](./AGENTS.md).

By contributing you agree that your contributions are licensed under the [MIT License](./LICENSE),
and you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Report security issues privately
([`SECURITY.md`](./SECURITY.md)).

## Prerequisites

- **Node.js** `^22.22.2 || ^24.15.0 || >=26` (the current LTS is recommended), with npm. The dev
  tooling (jsdom 30, Vite 8, Vitest 4) requires it. The published package itself runs in browsers and
  is consumable from Node 18 or later.
- **Chrome 116 or later**, to load the extension.
- git.

## Setup

```sh
git clone https://github.com/ezhillragesh/performance-engine.git
cd performance-engine
npm run setup          # npm ci in core/ and demo/ (the extension has no dependencies)
npm run check          # every gate except the browser e2e tests, about a minute
npm run e2e            # demo end-to-end tests (first time: npm --prefix demo run e2e:install)
```

There are no workspaces: `core/` and `demo/` each have their own `package.json` and lockfile. The root
`package.json` only holds convenience scripts.

Load the extension: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**,
and select `extension/`. After changing extension files, click the reload icon on the extension card
and reopen DevTools.

## The three subsystems

| Subsystem | What it is | Inner loop |
|-----------|------------|------------|
| `core/` | Framework-agnostic TypeScript library, the npm package `performance-engine`. ESM only, no runtime dependencies, no React dependency | `cd core && npx vitest` (watch), `npx vitest run tests/rules.test.ts -t "name"` |
| `extension/` | Chrome MV3 DevTools extension and toolbar popup. Vanilla JS, **no build step**, no npm dependencies | Serve the folder and open the preview harness: `cd extension && python3 -m http.server 8080`, then open `http://localhost:8080/dev/preview.html?theme=dark` (also `?mode=app\|injected\|devtools`, `?state=noengine`, `?perm=deny`, `?site=webstore\|blocked`, `?guide=1`) or `/dev/popup-preview.html`. See [docs/EXTENSION.md](./docs/EXTENSION.md#developing-the-extension) |
| `demo/` | React 19 + Vite showcase and load generator. Imports core from source as `performance-engine` (Vite alias and tsconfig `paths` to `../core/index.ts`) | `npm run dev` (from the root or `demo/`), then open DevTools → **Perf Intelligence**. `npm run e2e` runs the Playwright suite against the dev server and the production build |

Two cross-package couplings to keep in mind:

- **Editing `core/` can break the demo build** even when core typechecks, because the demo compiles
  core's sources with its own stricter settings. `cd demo && npm run build` is the cross-package type
  gate.
- **The extension uses core only through generated bundles** in `extension/vendor/`. After *any* core
  change, run `cd core && npm run build:extension` and commit the regenerated files with the change.
  Never edit `extension/vendor/*` by hand. CI fails if they drift.

## Gates

`npm run check` at the root runs everything below, in order. CI (`.github/workflows/ci.yml`) runs the
same commands.

| Gate | Command | Notes |
|------|---------|-------|
| Core types | `cd core && npm run typecheck` | Includes tests |
| Core tests | `cd core && npm test` | `test:core` (vitest, node env) and then `test:a11y` (jsdom, files run serially) |
| Core build and package | `cd core && npm run check:package` | Clean build (`tsconfig.build.json`; also copies `THIRD_PARTY_NOTICES.md` into `dist/`), then `npm pack` and consumer checks: Node import without a DOM, `tsc` under `bundler`, `node16` and `nodenext`, esbuild tree-shaking |
| Vendor drift | `npm run check:vendor` | Runs `build:extension`, then fails if `extension/vendor/` or `extension/THIRD_PARTY_NOTICES.txt` differ from what is committed (modified *or* untracked files). Locally it also fails until regenerated bundles are committed |
| Extension syntax | `npm run check:extension` | Checks classic scripts and panel ES modules separately. Plain `node --check` silently passes broken ES modules on Node 24 and later |
| Demo lint | `cd demo && npm run lint` | Must stay clean: react-hooks v7 strict, react-refresh |
| Demo build | `cd demo && npm run build` | `tsc -b && vite build`. Delete `demo/dist` afterwards if you like (it is git-ignored) |
| Demo e2e | `cd demo && npm run e2e` | Not part of `npm run check` (needs a browser), but CI runs it. Playwright (Chromium, `npm run e2e:install` once) starts its own servers on ports 5175 and 5176 and runs every scenario and its fixed version against dev and the production build. Reports go to `demo/playwright-report/` |

Speed guards: `core/tests/perf-budget.test.ts` (2000 events analysed in under 50 ms median, about
11 ms locally) and `core/a11y/__tests__/perf.test.ts` (5000 elements audited in under 600 ms median in
jsdom). Both can fail on a heavily loaded machine, so re-run before investigating. `npm run bench` is
informational.

## Conventions

**Core**

- Relative imports use explicit `.js` suffixes (`import { x } from "./y.js"`), so `dist/` is
  consumable as Node ESM.
- `core/index.ts` re-exports named, side-effect-free API only. `a11y/browser.ts` is the only file with
  side effects and is excluded from the npm build.
- Instrumentation **never throws into the host app**: wrap anything that touches the page in
- A stopped session must never touch the shared store (another copy or a newer session may own it).
  Web Vitals live for the page's lifetime and are not cleared by `clear()`. Actions are recorded only
  while a sampled session runs.
  `try`/`catch`. Everything must be a no-op without `window` or `document` (SSR, Node).
- Never mutate store events during analysis, and never infer `traceId` later by time.
- Engine or tooling work that renders UI must run inside `runDetached`, or it is blamed on the
  user's click.
- Render cost is the sum of `selfDurationMs`, never `durationMs` across nested components. Group renders
  by `instanceId`.
- Getters may re-analyse but never notify subscribers synchronously. `onInsights` and snapshots always
  carry the full insight list.
- `core/tsconfig.json` enforces `noUnusedLocals` and `noUnusedParameters`.
- **Every core fix comes with a regression test.**

**Extension**

- Page payloads are untrusted. Never use `innerHTML` with page data, and render text with
  `textContent`. All validation lives in `devtools/panel/validate.js`, which you must keep in sync
  with `core/types`.
- Only top-frame messages are accepted. Do not add permissions without a strong need (today:
  `storage`, `scripting`, and `optional_host_permissions` granted per site).
- The MV3 service worker can die at any time. Never keep state only in memory.
- Never render accessibility engine names, vendor messages or vendor help URLs (link W3C Understanding
  pages only). `sources` stay hidden.

**Privacy (everywhere)**

- Never capture form values, input or `contenteditable` text, free page text, or URL query values.
  Accessibility findings carry a CSS path, a redacted snippet and non-PII `detail` only. See
  [ADR 0009](./docs/adr/0009-privacy-by-construction.md).
- Read text with `textContent` (never `innerText`, which forces layout), and never mutate the audited
  DOM.

**Style**

- Formatting follows [`.editorconfig`](./.editorconfig): 2 spaces, LF, final newline. Core uses double
  quotes, the demo single quotes. Match the surrounding file.
- Keep contracts in sync in the same change: [`docs/PROTOCOL.md`](./docs/PROTOCOL.md),
  [`docs/CORE_API.md`](./docs/CORE_API.md), `core/types/*.ts`.

## Recipes

### Add an analysis rule

1. Add the new value to the closed `IssueType` union in `core/types/insights.ts`.
2. Implement an `AnalysisRule` (`{ name, run(context, options) }`) in the matching
   `core/analyzer/rules/*.ts` file. Scope it to a trace (`context.traces`), never to the global
   `context.events`. Build the insight with `createInsight`, with `evidence[]` (measured value, unit,
   threshold, `eventIds`, weight) and `confidenceFromEvidence`. Anchor `id` on the trigger or first
   event, so it stays stable as the window grows. Derive severity from magnitude (`severityFromLatency`,
   `severityFromRatio`).
3. Register it in `core/analyzer/rules/index.ts`. **Order matters**: `keystroke-render-loop` before
   `interaction-induced-render-burst`, and `budget-exceeded` last. If a budget covers the same problem,
   add the new issue type to `COVERED_BY` in `rules/budget.ts`.
4. Add tests in `core/tests/rules.test.ts`: at least one **positive** and one **negative** fixture
   (`core/tests/fixtures.ts`), plus id stability if the window can grow.
5. Add a Scenario Lab card in the demo, with a fixed version that must not produce the insight (see
   below).
6. Update the rule tables in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md#6-analysis-pipeline-and-rule-contract)
   and in `CORE_API.md` if the public surface changed. Then run `npm run build:extension` and commit
   the vendor bundles.

### Add or change an accessibility rule

The UI shows one unified rule set (`core/a11y/catalog/unified.ts`). Three engines feed it
([ADR 0007](./docs/adr/0007-unified-a11y-rule-set.md)).

- **Built-in (ported) rules** live in `core/a11y/rules/*` (one element walk with per-tag dispatch,
  `engine.ts`). Message and WCAG metadata live in `catalog.ts` and `meta.ts`. Every rule needs
  positive and negative tests in `core/a11y/__tests__/`, and `coverage.test.ts` checks that every
  messageId is exercised.
- **Unified rules**: add or extend an entry in `DEFS` in `catalog/unified.ts`, with our own title,
  description and how-to-fix, the WCAG criteria, and the source ids it covers (`ai(…)`, `ibm(…)`,
  `axe(…)`). Never copy vendor wording.
- **A new duplicate pair** (the same problem reported twice): fix it with the policy tables in
  `catalog/unified.ts` (`PAGE_RULES`, `SUBSUMED_BY`, `NESTED_POLICY`, `NESTED_INTO`, `REFINE`,
  `CHECK_REFINE`), never with selector-string matching. Add a regression test in `dedupe.test.ts` that
  uses the concrete source ids.
- Never hand-port or edit IBM or axe rules. They are vendored unchanged.
- `panel-list.test.ts` runs the real panel view against the vendored engines, so regenerate the
  bundles (`npm run build:extension`) before running it.

### Upgrade an accessibility engine (IBM Equal Access or axe-core)

1. Bump the exact version in `core/package.json` (and in `demo/package.json`).
2. Update `IBM_ACE_VERSION` / `AXE_CORE_VERSION` in `core/a11y/loaders.ts` (`build:a11y` refuses a
   mismatch).
3. `cd core && npm install && npm run build:extension && npm test`.
4. `unified-coverage.test.ts` lists new source ids without a unified rule, and stale ones. Map each new
   id into an existing unified rule in `catalog/unified.ts`, or add a rule in our own words, then
   re-run.
5. Update the version and copyright lines in `THIRD_PARTY_NOTICES.md` and rebuild (it is copied to
   `extension/THIRD_PARTY_NOTICES.txt`).

### Add a DevTools panel view

1. Create `extension/devtools/panel/views/<name>.js` exporting `create<Name>View(ctx)`, where
   `ctx = { store, actions, statusEmpty }`. It returns `{ el, render(topic), focusSearch?, clearSearch? }`.
2. Add one row to the `VIEWS` array in `extension/devtools/panel/main.js` (`{ id, label, icon, create }`).
   That row derives the tab, the panel, the keyboard shortcut (1 to 9 by position) and dirty tracking.
3. Handle every `store.mode` (`app`, `injected`, `devtools`, `imported`) and `store.readOnly`
   (imported bundles). In DevTools-only mode, show an "Enable on this site" prompt for data that needs
   an engine.
4. Put styles for a large view in their own CSS file, linked from both `devtools/panel.html` and
   `dev/preview.html`.
5. Add any new page-provided fields to `devtools/panel/validate.js`, and render them with `textContent`.
6. Check the view in `dev/preview.html` in light and dark, and in every mode (`?mode=…`).
7. `npm run check:extension`.

### Add a demo scenario

Deliberate performance problems live **only** in `demo/src/scenarios/` and are marked
`INTENTIONAL`. Each Scenario Lab card targets one issue type, and its **Fixed version** must not
produce it. Register the card in `src/scenarios/catalog.ts` (`SCENARIOS`, used by "Run all") and in
`ScenarioLab.tsx`, and add it to `CASES` in `demo/e2e/scenarios.spec.ts` with the issue types it must
produce, so the end-to-end suite checks both versions. The Healthy control must keep producing zero insights, and the Workspace tab must
stay jank-free. `EngineStatus` is excluded from `instrumentReact` and must not select values that its
own renders feed.

### Change the page ⇄ extension protocol

Update `core/types/protocol.ts`, the bridge, `extension/background.js` and `contentScript.js` as
needed, `devtools/panel/validate.js`, and [`docs/PROTOCOL.md`](./docs/PROTOCOL.md), all in the same
change. Keep older panels and pages working where practical (the panel still accepts v1 messages).

## Commits and pull requests

Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>): <summary in the imperative, lower case, no period>
```

- **Types**: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
- **Scopes**: `core`, `analyzer`, `react`, `a11y`, `bridge`, `extension`, `panel`, `demo`, `docs`,
  `deps`, `release`.
- **Breaking changes**: add `!` after the scope and a `BREAKING CHANGE:` footer with a migration note.
- A core change and its regenerated `extension/vendor/` bundles belong in the **same commit**.

Examples: `feat(analyzer): add layout-thrash rule`, `fix(react): keep RDT hook chain after late install`,
`docs(adr): record unified a11y rule set`.

Pull requests: keep each one focused, fill in the template, make sure `npm run check` passes, and add
an entry to the top (unreleased) section of [`CHANGELOG.md`](./CHANGELOG.md) for user-visible changes.
Include a screenshot for panel UI changes.

## Release process

One version number covers the npm package and the extension.

1. **Version**: set the same `X.Y.Z` in `core/package.json` (then `cd core && npm install` to update
   the lockfile) and in `extension/manifest.json`.
2. **Bundles**: `npm run build:extension`, so the vendor bundles carry the new engine version.
3. **Changelog**: rename the top section to `## [X.Y.Z] - YYYY-MM-DD`, update the link references at
   the bottom, and start a new unreleased section if needed.
4. **Verify**: `npm run check` and `npm run e2e`. Then build the store zip with `npm run package:extension`
   (which verifies the manifest and HTML paths), and load the zip's contents unpacked once as a smoke
   test.
5. **Commit and tag**: `chore(release): vX.Y.Z`, then `git tag vX.Y.Z && git push origin main vX.Y.Z`.
6. **npm and GitHub release**: pushing the tag runs [`.github/workflows/release.yml`](./.github/workflows/release.yml).
   It re-runs every gate, checks that the tag matches both versions and that a dated changelog section
   exists, publishes `performance-engine` with provenance, and creates a GitHub release with the
   extension zip. Running the workflow manually (Actions → Release → Run workflow) performs every check
   and an `npm publish --dry-run` only.
7. **Chrome Web Store**: `npm run package:extension` (`node scripts/package-extension.mjs`, output in
   `dist-extension/`), or take the zip from the GitHub release, then upload it in the Chrome Web Store
   developer dashboard. Store submission is manual.

**One-time setup for the release workflow**

- npm **trusted publishing**: on npmjs.com, under package settings → Trusted publishing, add GitHub
  Actions with repository `ezhillragesh/performance-engine` and workflow `release.yml`. No npm token
  is stored in GitHub. If the package does not exist on npm yet, publish the first version manually
  (`cd core && npm publish --access public`) and then configure trusted publishing. To use a token
  instead, add an `NPM_TOKEN` secret and set `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` on the publish
  step.
- A GitHub **environment** named `release` (Settings → Environments), ideally with required reviewers,
  so a pushed tag waits for approval before publishing.
- Enable **private vulnerability reporting** (Settings → Code security) for [`SECURITY.md`](./SECURITY.md).
