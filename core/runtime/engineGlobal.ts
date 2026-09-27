/**
 * Cross-copy registry (docs/PROTOCOL.md, "Handoff between two engine copies").
 *
 * A page can contain two independent copies of core: the app's own bundle and
 * the extension-injected one. Module state is per copy, so coordination goes
 * through `globalThis.__PERF_ENGINE_GLOBAL__`: the copy that owns the active
 * session registers itself there, and every other copy (its React commit
 * handler in particular) stays inert while it is not the owner.
 */

import type { EngineMode } from "../types/protocol.js";

export const ENGINE_GLOBAL_KEY = "__PERF_ENGINE_GLOBAL__";

export interface PerfEngineGlobal {
  kind: EngineMode;
  sessionId: string;
  /** Stops the registered session (and uninstalls its trackers + bridge). */
  stop: () => void;
  /** Identity of the module copy that registered (opaque). */
  copy?: object;
  engineVersion?: string;
}

/** Unique per module copy: two bundles of core get two different tokens. */
export const COPY_TOKEN: object = Object.freeze({ name: "perf-engine-copy" });

type GlobalBag = Record<string, unknown>;

export function readEngineGlobal(): PerfEngineGlobal | undefined {
  try {
    const value = (globalThis as GlobalBag)[ENGINE_GLOBAL_KEY];
    if (!value || typeof value !== "object") return undefined;
    return value as PerfEngineGlobal;
  } catch {
    return undefined;
  }
}

export function writeEngineGlobal(value: PerfEngineGlobal): void {
  try {
    (globalThis as GlobalBag)[ENGINE_GLOBAL_KEY] = value;
  } catch {
    // frozen/sealed global: coordination is best effort
  }
}

/** Removes the registration only if it still belongs to `sessionId`. */
export function clearEngineGlobal(sessionId: string): void {
  try {
    const current = readEngineGlobal();
    if (current && current.sessionId === sessionId) delete (globalThis as GlobalBag)[ENGINE_GLOBAL_KEY];
  } catch {
    // ignore
  }
}

/** True when this copy owns the registered session, or nobody is registered. */
export function isOwnerCopy(): boolean {
  const current = readEngineGlobal();
  return !current || current.copy === COPY_TOKEN;
}
