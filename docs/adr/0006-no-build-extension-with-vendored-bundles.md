# 0006. Keep the extension build-free with checked-in generated bundles

- Status: Accepted
- Date: 2026-11-10 (recorded retroactively)

## Context

The extension needs core code: the injected engine, the analyzer for DevTools-only mode, and the
accessibility audit. It also needs two third-party engines (IBM Equal Access, axe-core). A bundler
toolchain for the extension would mean that a contributor cannot load `extension/` unpacked straight
from a clone, that store review sees minified output it cannot match to a source tree, and that there
are two build systems to keep in sync.

## Decision

- The extension is vanilla JS with no build step and no npm dependencies. The panel is plain ES
  modules, and the background, content script and DevTools page are classic scripts.
- Core code reaches the extension only through generated files in `extension/vendor/`, produced by
  `cd core && npm run build:extension` (esbuild, `core/scripts/build-extension.mjs` and
  `build-a11y.mjs`) and **checked in**. The third-party engines are copied byte-for-byte from pinned
  exact devDependencies, with their license banners kept. `THIRD_PARTY_NOTICES.md` is copied to
  `extension/THIRD_PARTY_NOTICES.txt`.
- Generated files carry a "do not edit" banner and are never edited by hand. CI regenerates them and
  fails on any difference (`scripts/check-vendor.mjs`).

## Consequences

- `chrome://extensions` → Load unpacked → `extension/` works from a fresh clone, and the store zip is
  packaged from the folder with no compile step (`node scripts/package-extension.mjs`).
- Any core change requires regenerating and committing the vendor bundles in the same change. This is
  easy to forget, which is why CI checks it.
- Diffs touching `extension/vendor/` are noisy. Reviewers review the core source, and CI proves the
  bundle matches it.
- There is no type checking for the extension. Validation lives in `devtools/panel/validate.js`, kept
  in sync with `core/types` by review, and syntax is checked by `scripts/check-extension.mjs`.

## Alternatives considered

- **Bundling the extension (Vite or webpack)**: TypeScript in the panel, but a second toolchain, a
  build before load, and output that is harder to review.
- **Generating bundles in CI only (not committed)**: unpacked loading from a clone would break.
- **Fetching third-party engines at runtime from a CDN**: remote code is disallowed in MV3, and it
  would leak the inspected site to a third party.
