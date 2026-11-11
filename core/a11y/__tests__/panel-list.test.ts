// The DevTools Accessibility list end to end, without Chrome: the REAL panel view module
// (extension/devtools/panel/views/accessibility.js) drives a jsdom "inspected page" through an
// inspectedWindow.eval stand-in, and the page runs the REAL vendored bundles (vendor/a11y-audit.js,
// ibm-ace.js, axe.min.js). Checks that the list never shows duplicates: each finding once per
// group, header counts = rows, and rescans / Live / standard switches replace the state instead of
// accumulating. Needs current vendor bundles (`npm run build:extension`).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeWindow, type TestWindow } from "./engines.js";

const ext = resolve(dirname(fileURLToPath(import.meta.url)), "../../../extension");
const read = (p: string) => readFileSync(resolve(ext, p), "utf8");

interface Finding {
  id: string;
  ruleId: string;
  node?: string;
  criteria?: string[];
  wcag: string;
}
interface View {
  el: HTMLElement;
  rescan(): void;
  setStandard(s: Record<string, unknown>): void;
  destroy(): void;
  getReport(): { findings: Finding[]; counts: { errors: number; reviews: number; warnings: number } } | null;
  readonly state: { scanning: boolean; parts: string[]; standard: Record<string, unknown>; error: string | null };
}
interface PanelModule {
  createAccessibilityView(ctx: object, deps: object): View;
  GROUP_PAGE: number;
}

const BODY = `<main>
  <h1>Inbox</h1>
  <img src="a.png">
  <button type="button"><svg width="12" height="12"></svg></button>
  <input type="text" name="q" placeholder="Search">
  <div id="host"></div>
  <ul><li><a href="/p">click here</a></li></ul>
  ${Array.from({ length: 60 }, (_, i) => `<img src="p${i}.png" width="4" height="4">`).join("")}
</main>
<p>outside</p>`;

function page(): TestWindow {
  const w = makeWindow(BODY);
  w.document.getElementById("host")!.attachShadow({ mode: "open" }).innerHTML = `<img src="s.png"><button></button>`;
  return w;
}

/** inspectedWindow.eval stand-in: evaluates in the page window, returns a JSON clone (like DevTools). */
const evalIn = (w: TestWindow) => async (code: string) => {
  const r = w.eval(code) as unknown;
  return r === undefined ? undefined : JSON.parse(JSON.stringify(r));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function idle(view: View, startWithin = 300): Promise<boolean> {
  const t0 = Date.now();
  while (!view.state.scanning && Date.now() - t0 < startWithin) await sleep(20);
  const started = view.state.scanning;
  while (view.state.scanning) await sleep(50);
  return started;
}

function groups(view: View) {
  for (const b of view.el.querySelectorAll<HTMLButtonElement>(".a11y-show-all")) if (!b.hidden) b.click();
  return [...view.el.querySelectorAll<HTMLElement>(".a11y-group")].map((g) => ({
    key: g.dataset.key!,
    header: Number(g.querySelector(".a11y-group-count")!.textContent),
    ids: [...g.querySelectorAll<HTMLElement>("li[role=option]")].map((li) => li.dataset.id!),
    also: [...g.querySelectorAll(".a11y-also")].map((c) => c.textContent),
  }));
}

function clickSeg(view: View, cls: string, label: string) {
  const b = [...view.el.querySelectorAll<HTMLButtonElement>(`${cls} .segment`)].find((x) => x.textContent!.trim() === label)!;
  b.click();
}

const keys = (view: View) => view.getReport()!.findings.map((f) => `${f.ruleId}|${f.node ?? f.id}`).sort();

async function mountedView(w: TestWindow) {
  const file = resolve(ext, "devtools/panel/views/accessibility.js").split("\\").join("/");
  const mod = (await import(/* @vite-ignore */ file)) as PanelModule;
  const view = mod.createAccessibilityView({}, {
    evalInPage: evalIn(w),
    loadAuditSource: async () => read("vendor/a11y-audit.js"),
    loadEngineSource: async (n: string) => read(n === "ibm" ? "vendor/ibm-ace.js" : "vendor/axe.min.js"),
    subscribeNavigation: () => () => {},
  });
  document.body.replaceChildren(view.el);
  return { view, mod };
}

describe("Accessibility list (real panel view + real engines)", () => {
  it("lists every finding once, header counts match rows, rescans / live / standard switches never accumulate", async () => {
    localStorage.clear();
    const w = page();
    const { view, mod } = await mountedView(w);
    view.rescan();
    await idle(view);
    expect(view.state.error).toBeNull();
    expect(view.state.parts.sort()).toEqual(["a11yinspect", "axe", "ibm"]);
    const r = view.getReport()!;
    const n = r.findings.length;
    expect(n).toBeGreaterThan(10);
    // (a) one finding per element + rule; ids unique
    expect(new Set(r.findings.map((f) => f.id)).size).toBe(n);
    expect(new Set(keys(view)).size).toBe(n);
    // the shadow-DOM image is one finding (axe and IBM describe it differently)
    expect(r.findings.filter((f) => f.ruleId === "image-alt" && /#document-fragment/.test((f as unknown as { selector: string }).selector))).toHaveLength(1);

    // A large group (the 61 images) shows GROUP_PAGE rows and "Show all N" until expanded.
    const big = [...view.el.querySelectorAll<HTMLElement>(".a11y-group")].find((g) => Number(g.querySelector(".a11y-group-count")!.textContent) > mod.GROUP_PAGE)!;
    expect(big).toBeDefined();
    const total = Number(big.querySelector(".a11y-group-count")!.textContent);
    const more = big.querySelector<HTMLButtonElement>(".a11y-show-all")!;
    expect(big.querySelectorAll("li[role=option]").length).toBe(mod.GROUP_PAGE);
    expect(more.hidden).toBe(false);
    expect(more.textContent).toBe(`Show all ${total}`);
    more.click();
    expect(big.querySelectorAll("li[role=option]").length).toBe(total);
    expect(more.hidden).toBe(true);
    expect(document.activeElement).toBe(big.querySelectorAll("li[role=option]")[mod.GROUP_PAGE]); // keyboard focus continues there

    // (e) both groupings: each finding exactly once, header count = rows, all counts agree
    for (const [label, by] of [["By rule", "rule"], ["By WCAG", "wcag"]] as const) {
      clickSeg(view, ".a11y-group-toggle", label);
      const gs = groups(view);
      const all = gs.flatMap((g) => g.ids);
      expect(all.length, by).toBe(n);
      expect(new Set(all).size, by).toBe(n);
      for (const g of gs) expect(g.header, g.key).toBe(g.ids.length);
      if (by === "wcag") {
        // a finding mapped to several criteria sits under its primary one and names the others
        const multi = r.findings.find((f) => (f.criteria ?? []).length > 1)!;
        expect(gs.find((g) => g.ids.includes(multi.id))!.key).toBe(`wcag:${multi.wcag}`);
        expect(gs.some((g) => g.also.length)).toBe(true);
      }
    }
    clickSeg(view, ".a11y-group-toggle", "By rule");
    expect(view.el.querySelector(".list-status")!.textContent).toBe(`${n} findings`);
    const pills = [...view.el.querySelectorAll(".a11y-count .num")].map((x) => Number(x.textContent));
    expect(pills.reduce((s, x) => s + x, 0)).toBe(n);
    expect(pills).toEqual([r.counts.errors, r.counts.reviews, r.counts.warnings]);

    // (f) rescans replace the state
    const base = keys(view);
    for (let i = 0; i < 2; i++) {
      view.rescan();
      await idle(view);
      expect(keys(view)).toEqual(base);
    }
    // Live: a DOM mutation adds exactly the new element's findings, removing it restores the list
    (view.el.querySelector(".a11y-live") as HTMLButtonElement).click();
    const probe = w.document.createElement("img");
    probe.setAttribute("src", "live.png");
    w.document.querySelector("main")!.appendChild(probe);
    expect(await idle(view, 8000)).toBe(true);
    const added = keys(view).filter((k) => !base.includes(k));
    expect(added.length).toBeGreaterThan(0);
    expect(keys(view).filter((k) => base.includes(k))).toEqual(base);
    probe.remove();
    expect(await idle(view, 8000)).toBe(true);
    expect(keys(view)).toEqual(base);
    (view.el.querySelector(".a11y-live") as HTMLButtonElement).click();
    // standard switches and toggles: back to the same list
    const std = view.state.standard;
    view.setStandard({ ...std, version: "2.0", level: "A" });
    await idle(view);
    expect(keys(view).length).toBeLessThan(base.length);
    view.setStandard(std);
    await idle(view);
    expect(keys(view)).toEqual(base);
    view.setStandard({ ...std, bestPractices: false });
    await idle(view);
    view.setStandard(std);
    await idle(view);
    expect(keys(view)).toEqual(base);

    // (g) engine names never reach the rendered UI (issues, details, WCAG and Rules views)
    const text: string[] = [view.el.textContent!];
    for (const li of [...view.el.querySelectorAll<HTMLElement>("li[role=option]")].slice(0, 20)) {
      li.click();
      text.push(view.el.querySelector(".a11y-detail-pane")!.textContent!);
    }
    for (const v of ["WCAG", "Rules", "Issues"]) {
      clickSeg(view, ".a11y-subviews", v);
      text.push(view.el.textContent!);
    }
    const attrs = [...view.el.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => a.name !== "class").map((a) => a.value));
    expect([...text, ...attrs].join("\n")).not.toMatch(/\b(ibm|axe|a11y ?inspect|deque|equal access|barrierbreak)\b/i);
    view.destroy();
  }, 120_000);
});
