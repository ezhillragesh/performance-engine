// Site access UX: limited-data banner, engine call-to-action empty states, the site-settings
// popover (grant / revoke / reload), the "How to install in your app" sheet and the
// "Getting started" guide that explains the three engine modes.
import { h, icon, replaceChildren, copyText } from "../dom.js";

export const INSTALL_SNIPPET = `// entry file, before react-dom
import { instrumentReact, initPerfEngine } from "performance-engine";
instrumentReact();
initPerfEngine();`;

const DEPENDENCY_SNIPPET = `// package.json of your app — the package is not on npm yet
"dependencies": {
  "performance-engine": "file:../performance-engine/core"
}`;

const BUILD_SNIPPET = `cd performance-engine/core && npm install && npm run build
cd your-app && npm install`;

export const MODE_META = {
  app: {
    label: "App engine",
    tip: "The page bundles the perf engine (initPerfEngine). Full data: causal traces, React renders, components, insights and Web Vitals.",
  },
  injected: {
    label: "Injected engine",
    tip: "The extension injects the perf engine into this site. Full data: causal traces, React renders (when React is detected), insights and Web Vitals. Click for site settings.",
  },
  devtools: {
    label: "DevTools only · limited",
    tip: "No engine on this page. Network, long tasks, interactions and Web Vitals come from DevTools APIs. Missing: causal traces, React renders and component stats. Click to enable the engine on this site.",
  },
};

const GUIDE_STORAGE_KEY = "perfEngine.guideSeen";

// Chrome never runs extension scripts here, whatever the host permissions say.
const RESTRICTED_HOSTS = new Set(["chromewebstore.google.com", "chrome.google.com"]);

export function isEnableableOrigin(origin) {
  return typeof origin === "string" && /^https?:\/\/[^/]+$/i.test(origin);
}

/** Why the engine can't be injected into `origin` (a sentence), or null when it can. */
export function originRestriction(origin) {
  if (typeof origin !== "string" || !origin) return null; // not known yet
  if (!isEnableableOrigin(origin)) return "Chrome doesn't let extensions run on this page (browser pages, other extensions, local files). Open a regular http(s) website.";
  try {
    if (RESTRICTED_HOSTS.has(new URL(origin).hostname)) return "Chrome doesn't let extensions run on the Chrome Web Store.";
  } catch {
    return "This page's address can't be used for site access.";
  }
  return null;
}

/** True once the user dismissed the first-run guide (chrome.storage.local). */
export async function loadGuideSeen() {
  try {
    const got = await chrome.storage.local.get(GUIDE_STORAGE_KEY);
    return got?.[GUIDE_STORAGE_KEY] === true;
  } catch {
    return true; // storage unavailable: never nag
  }
}

function saveGuideSeen() {
  try {
    void chrome.storage.local.set({ [GUIDE_STORAGE_KEY]: true }).catch(() => {});
  } catch {
    /* context invalidated */
  }
}

export function createSiteAccess(ctx) {
  const { store, actions } = ctx;
  let pop = null;
  let anchorEl = null;
  let sheet = null;
  let sheetKind = null;
  let lastFocus = null;
  let removeAccess = true; // "Also remove site access" when disabling
  let guideKey = ""; // state the open guide was rendered for

  const currentOrigin = () => store.state.injection.origin || store.state.page?.origin || "";

  function enableButton({ small = false, accent = true } = {}) {
    const inj = store.state.injection;
    const origin = inj.origin;
    const restricted = originRestriction(origin);
    const ok = isEnableableOrigin(origin) && !restricted;
    return h(
      "button",
      {
        type: "button",
        class: ["btn", accent ? "btn-accent" : "", small ? "btn-small" : ""],
        disabled: !ok || inj.pending === "enable" || store.readOnly,
        title: ok ? `Inject the perf engine on ${origin} (asks for site access, then reloads the page)` : restricted || "Only http(s) pages can run the injected engine",
        // Must stay synchronous up to chrome.permissions.request (user gesture).
        onClick: () => actions.enableInjection(),
      },
      icon("bolt", 14),
      h("span", { text: inj.pending === "enable" ? "Enabling…" : "Enable on this site" }),
    );
  }

  function installButton({ small = false } = {}) {
    return h("button", { type: "button", class: ["btn", small ? "btn-small" : ""], onClick: () => openInstall() }, icon("cube", 14), h("span", { text: "How to install in your app" }));
  }

  function reloadButton({ small = false, accent = false } = {}) {
    return h("button", { type: "button", class: ["btn", accent ? "btn-accent" : "", small ? "btn-small" : ""], title: "Reload the inspected page", onClick: () => actions.reloadPage() }, icon("refresh", 14), h("span", { text: "Reload page" }));
  }

  function messageLine() {
    const m = store.state.injection.message;
    if (!m) return null;
    return h("p", { class: `access-msg tone-${m.tone || "info"}`, role: m.tone === "error" ? "alert" : "status" }, icon(m.tone === "error" ? "warning" : m.tone === "good" ? "check" : "info", 12), h("span", { text: m.text }));
  }

  /** Compact banner shown in DevTools-only mode. */
  function limitedBanner() {
    if (store.state.imported || store.mode !== "devtools") return null;
    const inj = store.state.injection;
    const m = inj.message;
    const restricted = originRestriction(inj.origin);
    const unreadable = store.state.collector?.blocked === true;
    // Problems are shown even after the default banner was dismissed.
    if (store.state.limitedBannerDismissed && !m && !restricted && !unreadable) return null;
    let text = "Limited data: traces, React renders and components need the engine.";
    let tone = m ? m.tone || "info" : "";
    let buttons = [enableButton({ small: true }), installButton({ small: true })];
    if (m) {
      // Enable feedback (prompt pending, denied, blocked) replaces the default text where the user clicked.
      text = m.text;
    } else if (restricted || unreadable) {
      text = restricted || "Chrome doesn't let DevTools extensions read this page. Network data still appears when the page loads resources.";
      tone = "error";
      buttons = [];
    } else if (inj.enabled) {
      text = "Injection is enabled on this site, but its engine hasn't started on this page yet. Reload to start it.";
      buttons = [reloadButton({ small: true, accent: true })];
    }
    return h(
      "div",
      { class: ["banner", "banner-limited", tone ? `tone-${tone}` : ""], role: tone === "error" ? "alert" : "status" },
      icon(tone === "error" ? "warning" : tone === "good" ? "check" : "info", 14),
      h("span", { class: "banner-text", title: text, text }),
      h("span", { class: "spacer" }),
      h("span", { class: "banner-actions" }, buttons),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Dismiss", title: "Dismiss", onClick: () => store.update((s) => {
            s.limitedBannerDismissed = true;
            s.injection.message = null;
          }, "status") }, icon("close", 12)),
    );
  }

  /** Designed empty state for views that need the engine (Traces, Components). */
  function engineEmptyState({ iconName, title, body, bullets = [] }) {
    const imported = !!store.state.imported;
    const restricted = imported ? null : originRestriction(store.state.injection.origin);
    const enabled = !imported && store.state.injection.enabled;
    let actionsRow = null;
    if (!imported && !restricted) actionsRow = h("div", { class: "cta-actions" }, enabled ? reloadButton({ accent: true }) : enableButton(), installButton());
    let foot = null;
    if (imported) foot = h("p", { class: "caption muted", text: "This bundle was recorded in DevTools-only mode." });
    else if (restricted) foot = h("p", { class: "access-msg tone-error", role: "status" }, icon("lock", 12), h("span", { text: restricted }));
    return h(
      "div",
      { class: "empty empty-engine", role: "status" },
      h("div", { class: "empty-icon empty-icon-accent" }, icon(iconName, 28)),
      h("p", { class: "empty-title", text: title }),
      h("p", { class: "empty-body", text: body }),
      bullets.length ? h("ul", { class: "cta-bullets" }, bullets.map((b) => h("li", null, icon("check", 12), h("span", { text: b })))) : null,
      actionsRow,
      foot || messageLine(),
      imported || restricted
        ? null
        : h("p", { class: "caption muted cta-foot", text: enabled ? "Injection is enabled on this site: reload the page to start the engine." : "Enabling asks Chrome for access to this site only, injects the engine at page start and reloads the tab." }),
      imported ? null : h("button", { type: "button", class: "btn-link", onClick: () => openGuide(), text: "How the three modes work" }),
    );
  }

  // ── Site settings popover ──

  function closeSettings() {
    if (!pop) return;
    pop.remove();
    pop = null;
    document.removeEventListener("pointerdown", onOutside, true);
    anchorEl?.setAttribute("aria-expanded", "false");
  }
  function onOutside(e) {
    if (pop && !pop.contains(e.target) && !anchorEl?.contains(e.target)) closeSettings();
  }

  function settingsBody() {
    const mode = store.mode;
    const inj = store.state.injection;
    const origin = currentOrigin();
    const restricted = originRestriction(inj.origin);
    const rows = [];
    const meta = MODE_META[mode];
    rows.push(h("div", { class: "access-mode" }, h("span", { class: `mode-dot mode-${mode || "none"}` }), h("strong", { text: meta ? meta.label : "Detecting engine…" })));
    if (meta) rows.push(h("p", { class: "caption muted", text: meta.tip.replace(" Click for site settings.", "").replace(" Click to enable the engine on this site.", "") }));
    rows.push(
      h(
        "div",
        { class: "access-origin" },
        icon(restricted ? "lock" : "globe", 14),
        h("span", { class: "mono ellipsis", title: origin, text: origin || "Unknown site" }),
        h("span", { class: "spacer" }),
        inj.known && !restricted ? h("span", { class: ["pill", inj.granted ? "pill-pass" : "pill-no-data"], text: inj.granted ? "Access granted" : "No site access" }) : null,
      ),
    );
    if (restricted) {
      rows.push(h("p", { class: "access-msg tone-error" }, icon("lock", 12), h("span", { text: restricted })));
    } else if (inj.enabled) {
      rows.push(
        h("p", { class: "caption", text: mode === "app" ? "Injection is enabled here, but the page's own engine took over (an app engine always wins)." : mode === "injected" ? "The engine is injected into this site at page start." : "Injection is enabled, but the engine hasn't started on this page yet. Reload to start it." }),
        h(
          "div",
          { class: "access-actions" },
          mode === "devtools" ? reloadButton({ accent: true }) : null,
          h("button", { type: "button", class: "btn btn-danger", disabled: inj.pending === "disable", onClick: () => actions.disableInjection({ removePermission: removeAccess }) }, icon("close", 14), h("span", { text: inj.pending === "disable" ? "Disabling…" : "Disable on this site" })),
        ),
        h(
          "label",
          { class: "access-check" },
          h("input", { type: "checkbox", checked: removeAccess, onChange: (e) => (removeAccess = e.target.checked) }),
          h("span", { text: "Also remove site access (Chrome forgets the permission)" }),
        ),
        h("p", { class: "caption muted", text: "Disabling removes the injected script and reloads the page." }),
      );
    } else if (mode === "app") {
      rows.push(h("p", { class: "caption muted", text: "Nothing to configure: the page bundles its own engine." }));
      if (inj.granted) rows.push(h("div", { class: "access-actions" }, revokeButton()));
    } else {
      rows.push(h("div", { class: "access-actions" }, enableButton(), installButton()));
      if (inj.granted) rows.push(h("div", { class: "access-actions" }, revokeButton()));
      rows.push(h("p", { class: "caption muted", text: "Chrome asks to let Perf Intelligence read and change data on this site only. The page then reloads with the engine injected. If no prompt appears, use the Perf Intelligence button in Chrome's toolbar." }));
    }
    const msg = messageLine();
    if (msg) rows.push(msg);
    rows.push(h("button", { type: "button", class: "btn-link access-guide", onClick: () => openGuide(), text: "How the three modes work" }));
    return rows;
  }

  function revokeButton() {
    const inj = store.state.injection;
    return h("button", { type: "button", class: "btn", disabled: !!inj.pending, title: "Remove this site's permission from Perf Intelligence", onClick: () => actions.disableInjection({ removePermission: true }) }, icon("lock", 14), h("span", { text: "Remove site access" }));
  }

  function openSettings(anchor) {
    if (pop) return closeSettings();
    anchorEl = anchor;
    pop = h("div", { class: "popover popover-access", role: "dialog", "aria-modal": "false", "aria-label": "Site settings" });
    pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSettings();
        anchorEl?.focus();
      }
    });
    renderSettings();
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left)))}px`;
    anchor.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onOutside, true);
    pop.querySelector("button:not([disabled])")?.focus();
  }

  function renderSettings() {
    if (!pop) return;
    const focusedText = pop.contains(document.activeElement) ? document.activeElement.textContent : null;
    replaceChildren(
      pop,
      h("div", { class: "popover-head" }, icon("gauge", 16), h("h2", { text: "Site settings" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: closeSettings }, icon("close", 14))),
      h("div", { class: "access-body" }, settingsBody()),
    );
    // Status updates re-render the popover: keep keyboard focus on the same control.
    if (focusedText !== null) [...pop.querySelectorAll("button, input")].find((b) => b.textContent === focusedText && !b.disabled)?.focus();
  }

  // ── Sheets (modal, dropping from the toolbar) ──

  function codeBlock(text, label) {
    const btn = h("button", { type: "button", class: "btn btn-small copy-btn", "aria-label": `Copy ${label}` }, h("span", { text: "Copy" }));
    const code = h("code", { text });
    btn.addEventListener("click", () =>
      copyText(text).then((ok) => {
        btn.firstChild.textContent = ok ? "Copied" : "Copy failed";
        setTimeout(() => (btn.firstChild.textContent = "Copy"), 1500);
      }),
    );
    return h("div", { class: "code-wrap" }, h("pre", { class: "code" }, code), btn);
  }

  function closeSheet() {
    if (!sheet) return;
    if (sheetKind === "guide") saveGuideSeen();
    sheet.remove();
    sheet = null;
    sheetKind = null;
    lastFocus?.focus?.();
  }

  function openSheet(kind, { iconName, title, subtitle, body, primary = "Done" }) {
    closeSettings();
    if (sheet) closeSheet();
    lastFocus = document.activeElement;
    sheetKind = kind;
    const titleId = `sheet-title-${kind}`;
    const panel = h(
      "div",
      { class: ["sheet", `sheet-${kind}`], role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      h(
        "div",
        { class: "sheet-head" },
        h("div", { class: "sheet-icon" }, icon(iconName, 18)),
        h("div", { class: "sheet-titles" }, h("h2", { id: titleId, text: title }), h("p", { class: "caption muted", text: subtitle })),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: closeSheet }, icon("close", 14)),
      ),
      body,
      h("div", { class: "sheet-actions" }, h("span", { class: "spacer" }), h("button", { type: "button", class: "btn btn-accent sheet-done", onClick: closeSheet, text: primary })),
    );
    sheet = h("div", { class: "sheet-backdrop", onClick: (e) => e.target === sheet && closeSheet() }, panel);
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeSheet();
      } else if (e.key === "Tab") {
        // Keep focus inside the modal sheet.
        const f = [...panel.querySelectorAll("button:not([disabled]), a[href], input:not([disabled])")];
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) {
          f[f.length - 1].focus();
          e.preventDefault();
        } else if (!e.shiftKey && i === f.length - 1) {
          f[0].focus();
          e.preventDefault();
        }
      }
    });
    document.body.appendChild(sheet);
    panel.querySelector(".sheet-done")?.focus({ preventScroll: true });
    return panel;
  }

  function openInstall() {
    openSheet("install", {
      iconName: "cube",
      title: "Install the engine in your app",
      subtitle: "Full data everywhere — traces, React renders, components — without per-site injection.",
      body: h(
        "ol",
        { class: "steps" },
        h(
          "li",
          null,
          h("h3", { text: "Add the package" }),
          h("p", { class: "caption", text: "performance-engine isn't published to npm yet. Depend on the repo's core/ folder with a local path (file:) dependency:" }),
          codeBlock(DEPENDENCY_SNIPPET, "dependency"),
          h("p", { class: "caption muted", text: "The package exports its compiled dist/, so build core once before installing:" }),
          codeBlock(BUILD_SNIPPET, "build commands"),
        ),
        h(
          "li",
          null,
          h("h3", { text: "Start it before React" }),
          codeBlock(INSTALL_SNIPPET, "snippet"),
          h("p", { class: "caption muted", text: 'ES imports are hoisted: if your entry file also imports react-dom, put these lines in their own module (e.g. perf.ts) and make import "./perf"; the first line of the entry file.' }),
        ),
        h("li", null, h("h3", { text: "Reload the page" }), h("p", { class: "caption", text: "The panel switches to App engine mode automatically. An app engine always replaces an injected one." })),
      ),
    });
  }

  function modeCard(id, title, iconName, lines, cta) {
    const here = store.mode === id;
    return h(
      "li",
      { class: ["guide-mode", `guide-${id}`, here ? "is-current" : ""], "aria-current": here ? "true" : null },
      here ? h("span", { class: "pill pill-pass guide-here", text: "This page" }) : null,
      h("div", { class: "guide-mode-head" }, h("span", { class: `mode-dot mode-${id}`, "aria-hidden": "true" }), icon(iconName, 14), h("h3", { text: title })),
      h("ul", { class: "guide-lines" }, lines.map((l) => h("li", { text: l }))),
      cta || null,
    );
  }

  const guideStateKey = () => `${store.mode}|${store.readOnly}|${store.state.injection.origin}|${store.state.injection.pending}|${store.state.injection.enabled}`;

  function openGuide() {
    guideKey = guideStateKey();
    openSheet("guide", { iconName: "help", title: "Getting started with Perf Intelligence", subtitle: "Three ways to get data. The panel picks the best one for the inspected page automatically.", primary: "Got it", body: guideBody() });
  }

  /** The guide shows the current mode and site: rebuild its body when they change while it's open. */
  function refreshGuide() {
    if (sheetKind !== "guide" || !sheet) return;
    const key = guideStateKey();
    if (key === guideKey) return;
    guideKey = key;
    sheet.querySelector(".guide")?.replaceWith(guideBody());
  }

  function guideEnableButton() {
    const restricted = originRestriction(store.state.injection.origin);
    return h(
      "button",
      {
        type: "button",
        class: "btn btn-accent btn-small",
        disabled: !!restricted || store.state.injection.pending === "enable",
        title: restricted || "Asks Chrome for access to this site, then reloads the page with the engine",
        // Synchronous up to chrome.permissions.request (user gesture); feedback shows in the banner.
        onClick: () => {
          actions.enableInjection();
          closeSheet();
        },
      },
      icon("bolt", 14),
      h("span", { text: "Enable on this site" }),
    );
  }

  function guideBody() {
    const live = !store.readOnly;
    const restricted = live ? originRestriction(store.state.injection.origin) : null;
    const shortcuts = [
      ["1 – 7", "Switch views"],
      ["/", "Search the current view"],
      ["Space", "Pause / resume recording"],
      ["Esc", "Clear search, close dialogs"],
      ["↑ ↓ Enter", "Move through lists"],
    ];
    return h(
        "div",
        { class: "guide" },
        h(
          "ol",
          { class: "guide-modes" },
          modeCard("devtools", "DevTools only", "globe", ["Works on any website, no setup.", "Network, long tasks, interactions, Web Vitals, accessibility audit, insights from that data.", "No causal traces, React renders or component stats."], null),
          modeCard(
            "injected",
            "Injected engine",
            "bolt",
            ["You enable it per site: Chrome asks for access to that site only.", "Adds causal traces (click → requests → renders), React renders on React sites, render insights.", "React production builds: no render timings and minified component names."],
            live && !restricted && store.mode !== "injected" && store.mode !== "app" ? h("div", { class: "guide-cta" }, guideEnableButton()) : null,
          ),
          modeCard(
            "app",
            "App engine",
            "cube",
            ["Your app bundles the performance-engine package.", "Full data on every load, including render timings in development builds.", "Always wins over an injected engine."],
            live ? h("div", { class: "guide-cta" }, h("button", { type: "button", class: "btn btn-small", onClick: () => openInstall() }, icon("cube", 14), h("span", { text: "Setup steps" }))) : null,
          ),
        ),
        restricted ? h("p", { class: "access-msg tone-error" }, icon("lock", 12), h("span", { text: restricted })) : null,
        h("p", { class: "guide-privacy caption" }, icon("lock", 12), h("span", { text: "Everything stays in your browser: nothing is sent to a server. Site access can be removed any time from Site settings (the mode badge) or the toolbar button." })),
        h("h3", { class: "guide-sub", text: "Keyboard" }),
        h("dl", { class: "guide-keys" }, shortcuts.map(([k, v]) => [h("dt", null, h("kbd", { text: k })), h("dd", { text: v })])),
      );
  }

  return {
    limitedBanner,
    engineEmptyState,
    enableButton,
    installButton,
    openSettings,
    closeSettings,
    renderSettings,
    openInstall,
    openGuide,
    refreshGuide,
    closeInstall: closeSheet,
    get isOpen() {
      return !!pop || !!sheet;
    },
    closeAll() {
      closeSettings();
      closeSheet();
    },
  };
}
