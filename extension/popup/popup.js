// Toolbar popup: per-site status and the reliable place to grant / revoke site access for the
// injected engine (docs/PROTOCOL.md "Toolbar popup"). Classic script, no dependencies.
// Everything shown comes from the background / content script and is rendered with textContent.
(function () {
  "use strict";

  var root = document.getElementById("popup");
  var HOMEPAGE = "https://github.com/ezhillragesh/performance-engine";
  var PRIVACY = HOMEPAGE + "/blob/main/docs/PRIVACY.md";
  var GUIDE = HOMEPAGE + "/blob/main/docs/EXTENSION.md";
  var RESTRICTED_HOSTS = { "chromewebstore.google.com": 1, "chrome.google.com": 1 };

  var tab = null; // { id }
  var page = null; // { origin, title } from the content script, null when unreachable
  var status = null; // POPUP_STATUS reply
  var busy = null; // "enable" | "disable" | null
  var message = null; // { tone, text }
  var removeAccess = true;

  // ── Tiny DOM helper (no innerHTML) ──
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === "text") el.textContent = String(v);
        else if (k === "class") el.className = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "disabled" || k === "checked") el[k] = !!v;
        else el.setAttribute(k, v === true ? "" : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) el.appendChild(x); });
      else el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return el;
  }

  function applyTheme() {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var set = function () {
      document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
      document.documentElement.style.colorScheme = mq.matches ? "dark" : "light";
    };
    set();
    if (mq.addEventListener) mq.addEventListener("change", set);
  }

  function isWebOrigin(origin) {
    return typeof origin === "string" && /^https?:\/\/[^/]+$/i.test(origin);
  }

  function isRestricted(origin) {
    try {
      return RESTRICTED_HOSTS[new URL(origin).hostname] === 1;
    } catch (e) {
      return true;
    }
  }

  function devtoolsShortcut() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    return /mac/i.test(p) ? "⌥⌘I" : "Ctrl+Shift+I";
  }

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (reply) {
          void chrome.runtime.lastError;
          resolve(reply || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function pageInfo(tabId) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(tabId, { type: "PAGE_INFO" }, { frameId: 0 }, function (reply) {
          void chrome.runtime.lastError; // no content script: chrome://, Web Store, tab opened before install
          resolve(reply && typeof reply.origin === "string" ? { origin: reply.origin.slice(0, 300), title: String(reply.title || "").slice(0, 200) } : null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function refresh() {
    if (!tab) return Promise.resolve();
    return pageInfo(tab.id).then(function (info) {
      page = info;
      var origin = info && isWebOrigin(info.origin) ? info.origin : undefined;
      return send({ type: "POPUP_STATUS_REQUEST", tabId: tab.id, origin: origin }).then(function (reply) {
        status = reply && reply.type === "POPUP_STATUS" ? reply : null;
        render();
      });
    });
  }

  function applyInjectionReply(reply, what) {
    busy = null;
    if (!reply || reply.type !== "INJECTION_STATUS") {
      message = { tone: "error", text: "The extension didn't answer. Reload it on chrome://extensions and try again." };
    } else if (reply.error) {
      message = { tone: "error", text: reply.error === "restricted-origin" ? "Chrome doesn't allow extensions to run on this site." : String(reply.error).slice(0, 300) };
    } else if (what === "enable") {
      message = reply.enabled ? { tone: "good", text: "Enabled. The page reloads with the injected engine." } : { tone: "error", text: "Couldn't enable injection on this site." };
    } else {
      message = reply.enabled ? { tone: "error", text: "Couldn't disable injection on this site." } : { tone: "good", text: reply.granted ? "Disabled. The page reloads without the engine." : "Disabled and site access removed." };
    }
    if (status && reply && reply.type === "INJECTION_STATUS") status.injection = { origin: reply.origin, enabled: reply.enabled === true, granted: reply.granted === true };
    render();
    // The page reloads: read the new engine state once it had time to start.
    setTimeout(refresh, 1800);
  }

  function enable() {
    var origin = page && page.origin;
    if (!isWebOrigin(origin) || busy) return;
    // Recorded first: if this popup closes while Chrome's prompt is open, the background still
    // enables injection when the permission is granted (chrome.permissions.onAdded).
    send({ type: "INJECTION_INTENT", tabId: tab.id, origin: origin });
    var request;
    try {
      // Must run synchronously in the click handler (user gesture).
      request = chrome.permissions.request({ origins: [origin + "/*"] });
    } catch (e) {
      message = { tone: "error", text: "Chrome refused to ask for site access: " + String((e && e.message) || e).slice(0, 160) };
      return render();
    }
    busy = "enable";
    message = { tone: "info", text: "Waiting for Chrome's site-access prompt…" };
    render();
    Promise.resolve(request).then(
      function (granted) {
        if (!granted) {
          busy = null;
          message = { tone: "error", text: "Site access wasn't granted. DevTools-only data keeps working without it." };
          return render();
        }
        message = { tone: "info", text: "Access granted. Injecting the engine…" };
        render();
        send({ type: "ENABLE_INJECTION", tabId: tab.id, origin: origin }).then(function (r) { applyInjectionReply(r, "enable"); });
      },
      function (e) {
        busy = null;
        message = { tone: "error", text: String((e && e.message) || e).slice(0, 200) };
        render();
      },
    );
  }

  function disable(removePermission) {
    var origin = page && page.origin;
    if (!isWebOrigin(origin) || busy) return;
    busy = "disable";
    message = null;
    render();
    send({ type: "DISABLE_INJECTION", tabId: tab.id, origin: origin, removePermission: removePermission === true }).then(function (r) {
      applyInjectionReply(r, "disable");
    });
  }

  function reloadTab() {
    try {
      chrome.tabs.reload(tab.id);
    } catch (e) {
      /* tab gone */
    }
    message = { tone: "info", text: "Reloading the page…" };
    render();
    setTimeout(refresh, 1800);
  }

  // ── Rendering ──

  function modeRow(dotClass, label, body) {
    return h("div", { class: "pp-status" }, h("div", { class: "pp-mode" }, h("span", { class: "mode-dot " + dotClass, "aria-hidden": "true" }), h("span", { text: label })), body ? h("p", { class: "caption", text: body }) : null);
  }

  function statsRow(snap) {
    if (!snap) return null;
    var c = snap.insightCounts || {};
    var sev = ["critical", "high", "medium", "low"].map(function (k) {
      return h("span", { class: "pp-sev sev-" + k, title: (c[k] || 0) + " " + k, "aria-label": (c[k] || 0) + " " + k }, h("span", { class: "dot", "aria-hidden": "true" }), h("span", { class: "num", "aria-hidden": "true", text: String(c[k] || 0) }));
    });
    return h(
      "div",
      { class: "pp-stats" },
      h("span", { class: "pp-score num", title: "Health score", text: snap.score === null ? "—" : String(snap.score) }),
      h("span", { class: "caption", text: snap.insights + " insight" + (snap.insights === 1 ? "" : "s") }),
      sev,
    );
  }

  function siteRow(text) {
    return h("div", { class: "pp-site" }, h("span", { class: "mono ellipsis", title: text, text: text }));
  }

  function actions() {
    var inj = status && status.injection;
    var eng = status && status.engine;
    var out = [];
    if (inj && inj.enabled) {
      if (eng && eng.mode === "app") out.push(h("p", { class: "caption", text: "Injection is enabled here, but the page's own engine took over (an app engine always wins)." }));
      else if (!eng) out.push(h("div", { class: "pp-actions" }, h("button", { type: "button", class: "btn btn-accent", onClick: reloadTab, text: "Reload to start the engine" })));
      out.push(
        h(
          "div",
          { class: "pp-actions" },
          h("button", { type: "button", class: "btn btn-danger", disabled: !!busy, onClick: function () { disable(removeAccess); }, text: busy === "disable" ? "Disabling…" : "Disable on this site" }),
          h(
            "label",
            { class: "pp-check" },
            h("input", { type: "checkbox", checked: removeAccess, onChange: function (e) { removeAccess = e.target.checked; } }),
            h("span", { text: "Also remove site access" }),
          ),
        ),
      );
    } else if (eng && eng.mode === "app") {
      out.push(h("p", { class: "caption", text: "Nothing to enable: the page bundles its own engine." }));
    } else {
      out.push(
        h(
          "div",
          { class: "pp-actions" },
          h("button", { type: "button", class: "btn btn-accent", disabled: !!busy, onClick: enable, text: busy === "enable" ? "Enabling…" : "Enable on this site" }),
          inj && inj.granted ? h("button", { type: "button", class: "btn", disabled: !!busy, onClick: function () { disable(true); }, text: "Remove site access" }) : null,
        ),
        h("p", { class: "caption", text: "Asks Chrome for access to this site only, injects the engine at page start and reloads the tab. Nothing leaves your browser." }),
      );
    }
    return out;
  }

  function render() {
    var kids = [
      h("header", { class: "pp-head" }, h("img", { src: "../icons/icon32.png", alt: "" }), h("h1", { text: "Perf Intelligence" }), h("span", { class: "caption", text: "v" + chrome.runtime.getManifest().version })),
    ];
    if (!tab) {
      kids.push(modeRow("mode-none", "Loading…"));
    } else if (!page) {
      kids.push(
        modeRow("mode-blocked", "Can't reach this page", "Browser pages (chrome://, the Chrome Web Store, other extensions) can't be inspected. On a regular website, reload the tab: pages opened before the extension was installed or updated need a reload."),
        h("div", { class: "pp-actions" }, h("button", { type: "button", class: "btn", onClick: reloadTab, text: "Reload page" })),
      );
    } else if (!isWebOrigin(page.origin) || isRestricted(page.origin) || (status && status.restricted)) {
      kids.push(siteRow(page.origin || "This page"), modeRow("mode-blocked", "Not available on this page", "Chrome doesn't let extensions run on this page. Open a regular http(s) website."));
    } else {
      var eng = status && status.engine;
      var inj = status && status.injection;
      kids.push(siteRow(page.origin));
      if (!status) kids.push(modeRow("mode-none", "Checking…"));
      else if (eng && eng.mode === "app") kids.push(modeRow("mode-app", "App engine", "This page bundles the perf engine " + eng.engineVersion + (eng.react ? " · React detected" : "") + ". Full data in DevTools."));
      else if (eng) kids.push(modeRow("mode-injected", "Injected engine", "The extension runs engine " + eng.engineVersion + " on this site" + (eng.react ? " · React detected" : "") + "."));
      else if (inj && inj.enabled) kids.push(modeRow("mode-injected", "Injection enabled", "The engine starts on the next page load."));
      else kids.push(modeRow("mode-devtools", "No engine on this page", "DevTools-only data still works: network, long tasks, interactions, Web Vitals, accessibility. Enable the engine for causal traces and React renders."));
      kids.push(statsRow(status && status.snapshot));
      if (status) kids.push.apply(kids, actions());
    }
    if (message) kids.push(h("p", { class: "pp-msg tone-" + (message.tone || "info"), role: message.tone === "error" ? "alert" : "status", text: message.text }));
    kids.push(
      h("p", { class: "pp-hint" }, "Open DevTools (", h("kbd", { text: devtoolsShortcut() }), ") and pick the ", h("strong", { text: "Perf Intelligence" }), " tab for insights, traces, timeline and the accessibility audit."),
      h(
        "footer",
        { class: "pp-foot" },
        h("a", { href: GUIDE, target: "_blank", rel: "noopener", text: "Guide" }),
        h("span", { text: "·" }),
        h("a", { href: PRIVACY, target: "_blank", rel: "noopener", text: "Privacy" }),
        h("span", { class: "spacer" }),
        h("span", { text: "All data stays in your browser" }),
      ),
    );
    while (root.firstChild) root.removeChild(root.firstChild);
    kids.forEach(function (k) { if (k) root.appendChild(k); });
  }

  applyTheme();
  render();
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      void chrome.runtime.lastError;
      var t = tabs && tabs[0];
      if (!t || typeof t.id !== "number") {
        page = null;
        tab = { id: -1 };
        return render();
      }
      tab = { id: t.id };
      refresh();
    });
  } catch (e) {
    render();
  }
})();
