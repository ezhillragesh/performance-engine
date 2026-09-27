/**
 * Entry of `extension/vendor/perf-engine.inject.js` (IIFE, page MAIN world,
 * document_start). See docs/PROTOCOL.md "Engine modes & DevTools-only layer".
 *
 * - Does nothing when the app already runs its own engine ("app" wins).
 * - Otherwise instruments React (harmless on non-React pages: it only
 *   installs/chains the DevTools hook) and starts an "injected" session. If
 *   the app bundles core too, its initPerfEngine() later stops this session.
 */

import { instrumentReact } from "../react/instrumentReact.js";
import { initPerfEngine } from "../session.js";
import { readEngineGlobal } from "../runtime/engineGlobal.js";

(function startInjectedEngine(): void {
  try {
    if (typeof window === "undefined") return;
    if (readEngineGlobal()?.kind === "app") return;
    try {
      instrumentReact();
    } catch {
      // not fatal: renders are simply not recorded
    }
    initPerfEngine({ mode: "injected" });
  } catch {
    // never break the host page
  }
})();
