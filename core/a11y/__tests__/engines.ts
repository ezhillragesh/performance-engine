// Test helpers for the vendored rule engines: loads the REAL accessibility-checker-engine ace.js
// and axe-core axe.min.js (core devDependencies) into a fresh jsdom window with the same wrappers
// the DevTools panel uses (loaders.ts), and runs them against fixture markup.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";
import type { AceLike } from "../ibm.js";
import type { AxeLike } from "../axe.js";
import { ACE_GLOBAL_KEY, AXE_GLOBAL_KEY, wrapAceSource, wrapAxeSource } from "../loaders.js";

const require = createRequire(import.meta.url);
let aceSrc = "";
let axeSrc = "";

export const acePath = (): string => require.resolve("accessibility-checker-engine/ace.js");
export const axePath = (): string => require.resolve("axe-core/axe.min.js");
export const aceSource = (): string => (aceSrc ||= readFileSync(acePath(), "utf8"));
export const axeSource = (): string => (axeSrc ||= readFileSync(axePath(), "utf8"));
export const packageVersion = (name: string): string => (require(`${name}/package.json`) as { version: string }).version;

export type TestWindow = JSDOM["window"] & Record<string, unknown>;

/** A fresh jsdom window (scripts run only via window.eval, like inspectedWindow.eval). */
export function makeWindow(body: string, opts: { head?: string; lang?: string | null; url?: string } = {}): TestWindow {
  const lang = opts.lang === null ? "" : ` lang="${opts.lang ?? "en"}"`;
  const vc = new VirtualConsole(); // swallow jsdom "Not implemented" noise
  const dom = new JSDOM(`<!doctype html><html${lang}><head>${opts.head ?? "<title>Fixture</title>"}</head><body>${body}</body></html>`, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: opts.url ?? "https://fixture.test/page?secret=1",
    virtualConsole: vc,
  });
  return dom.window as TestWindow;
}

export function installAce(w: TestWindow): AceLike {
  w.eval(wrapAceSource(aceSource()));
  return (w[ACE_GLOBAL_KEY] as { ace: AceLike }).ace;
}

export function installAxe(w: TestWindow): AxeLike {
  w.eval(wrapAxeSource(axeSource()));
  return (w[AXE_GLOBAL_KEY] as { axe: AxeLike }).axe;
}
