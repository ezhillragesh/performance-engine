// "Enable on this site" UX: limited-data banner, engine call-to-action empty states,
// site-settings popover and the "How to install in your app" sheet.
import { h, icon, replaceChildren } from "../dom.js";

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

export function isEnableableOrigin(origin) {
  return typeof origin === "string" && /^https?:\/\/[^/]+$/i.test(origin);
}

export function createSiteAccess(ctx) {
  const { store, actions } = ctx;
  let pop = null;
  let anchorEl = null;
  let sheet = null;
  let lastFocus = null;

  function enableButton({ small = false, accent = true } = {}) {
    const inj = store.state.injection;
    const origin = store.state.injection.origin;
    const ok = isEnableableOrigin(origin);
    return h(
      "button",
      {
        type: "button",
        class: ["btn", accent ? "btn-accent" : "", small ? "btn-small" : ""],
        disabled: !ok || inj.pending === "enable" || store.readOnly,
        title: ok ? `Inject the perf engine on ${origin} (asks for site access, then reloads the page)` : "Only http(s) pages can run the injected engine",
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

  function messageLine() {
    const m = store.state.injection.message;
    if (!m) return null;
    return h("p", { class: `access-msg tone-${m.tone || "info"}`, role: m.tone === "error" ? "alert" : "status" }, icon(m.tone === "error" ? "warning" : m.tone === "good" ? "check" : "info", 12), h("span", { text: m.text }));
  }

  /** Compact banner shown in DevTools-only mode. */
  function limitedBanner() {
    if (store.state.imported || store.mode !== "devtools") return null;
    const m = store.state.injection.message;
    if (store.state.limitedBannerDismissed && !m) return null;
    // Enable feedback (prompt pending, denied, blocked) replaces the default text where the user clicked.
    const text = m ? m.text : "Limited data: traces, React renders and components need the engine.";
    return h(
      "div",
      { class: ["banner", "banner-limited", m ? `tone-${m.tone || "info"}` : ""], role: m?.tone === "error" ? "alert" : "status" },
      icon(m?.tone === "error" ? "warning" : m?.tone === "good" ? "check" : "info", 14),
      h("span", { class: "ellipsis banner-text", title: text, text }),
      h("span", { class: "spacer" }),
      enableButton({ small: true }),
      installButton({ small: true }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Dismiss", title: "Dismiss", onClick: () => store.update((s) => {
            s.limitedBannerDismissed = true;
            s.injection.message = null;
          }, "status") }, icon("close", 12)),
    );
  }

  /** Designed empty state for views that need the engine (Traces, Components). */
  function engineEmptyState({ iconName, title, body, bullets = [] }) {
    return h(
      "div",
      { class: "empty empty-engine", role: "status" },
      h("div", { class: "empty-icon empty-icon-accent" }, icon(iconName, 28)),
      h("p", { class: "empty-title", text: title }),
      h("p", { class: "empty-body", text: body }),
      bullets.length ? h("ul", { class: "cta-bullets" }, bullets.map((b) => h("li", null, icon("check", 12), h("span", { text: b })))) : null,
      store.state.imported ? null : h("div", { class: "cta-actions" }, enableButton(), installButton()),
      store.state.imported ? h("p", { class: "caption muted", text: "This bundle was recorded in DevTools-only mode." }) : messageLine(),
      store.state.imported ? null : h("p", { class: "caption muted cta-foot", text: "Enabling asks Chrome for access to this site only, injects the engine at page start and reloads the tab." }),
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
    const origin = inj.origin || store.state.page?.origin || "";
    const rows = [];
    const meta = MODE_META[mode];
    rows.push(h("div", { class: "access-mode" }, h("span", { class: `mode-dot mode-${mode || "none"}` }), h("strong", { text: meta ? meta.label : "Detecting engine…" })));
    if (meta) rows.push(h("p", { class: "caption muted", text: meta.tip.replace(" Click for site settings.", "").replace(" Click to enable the engine on this site.", "") }));
    rows.push(h("div", { class: "access-origin" }, icon("globe", 14), h("span", { class: "mono ellipsis", title: origin, text: origin || "Unknown site" })));
    if (inj.enabled) {
      rows.push(
        h("p", { class: "caption", text: mode === "app" ? "Injection is enabled here, but the page's own engine took over (an app engine always wins)." : "The engine is injected into this site at page start." }),
        h("div", { class: "access-actions" }, h("button", { type: "button", class: "btn btn-danger", disabled: inj.pending === "disable", onClick: () => actions.disableInjection() }, icon("close", 14), h("span", { text: inj.pending === "disable" ? "Disabling…" : "Disable on this site" }))),
        h("p", { class: "caption muted", text: "Removes the injected script and reloads the page." }),
      );
    } else if (mode === "app") {
      rows.push(h("p", { class: "caption muted", text: "Nothing to configure: the page bundles its own engine." }));
    } else {
      rows.push(h("div", { class: "access-actions" }, enableButton(), installButton()));
      rows.push(h("p", { class: "caption muted", text: "Chrome asks to let Perf Intelligence read and change data on this site only. The page then reloads with the engine injected." }));
    }
    const msg = messageLine();
    if (msg) rows.push(msg);
    return rows;
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
    replaceChildren(
      pop,
      h("div", { class: "popover-head" }, icon("gauge", 16), h("h2", { text: "Site settings" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: closeSettings }, icon("close", 14))),
      h("div", { class: "access-body" }, settingsBody()),
    );
  }

  // ── Install sheet ──

  function codeBlock(text, label) {
    const btn = h("button", { type: "button", class: "btn btn-small copy-btn", "aria-label": `Copy ${label}` }, h("span", { text: "Copy" }));
    const code = h("code", { text });
    btn.addEventListener("click", () => copy(text, code, btn));
    return h("div", { class: "code-wrap" }, h("pre", { class: "code" }, code), btn);
  }

  function copy(text, codeEl, btn) {
    const done = (ok) => {
      btn.firstChild.textContent = ok ? "Copied" : "Selected";
      setTimeout(() => (btn.firstChild.textContent = "Copy"), 1500);
    };
    const selectFallback = () => {
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      done(ok);
    };
    try {
      // The Clipboard API is often blocked inside DevTools; fall back to a selection copy.
      navigator.clipboard.writeText(text).then(() => done(true), selectFallback);
    } catch {
      selectFallback();
    }
  }

  function closeInstall() {
    if (!sheet) return;
    sheet.remove();
    sheet = null;
    lastFocus?.focus?.();
  }

  function openInstall() {
    closeSettings();
    if (sheet) return;
    lastFocus = document.activeElement;
    const panel = h(
      "div",
      { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "install-title" },
      h(
        "div",
        { class: "sheet-head" },
        h("div", { class: "sheet-icon" }, icon("cube", 18)),
        h("div", { class: "sheet-titles" }, h("h2", { id: "install-title", text: "Install the engine in your app" }), h("p", { class: "caption muted", text: "Full data everywhere — traces, React renders, components — without per-site injection." })),
        h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onClick: closeInstall }, icon("close", 14)),
      ),
      h(
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
      h("div", { class: "sheet-actions" }, h("span", { class: "spacer" }), h("button", { type: "button", class: "btn btn-accent", onClick: closeInstall, text: "Done" })),
    );
    sheet = h("div", { class: "sheet-backdrop", onClick: (e) => e.target === sheet && closeInstall() }, panel);
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeInstall();
      } else if (e.key === "Tab") {
        // Keep focus inside the modal sheet.
        const f = [...panel.querySelectorAll("button:not([disabled])")];
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
    panel.querySelector(".sheet-actions .btn-accent")?.focus();
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
    closeInstall,
    get isOpen() {
      return !!pop || !!sheet;
    },
    closeAll() {
      closeSettings();
      closeInstall();
    },
  };
}
