// Dev-only stub of the chrome.* APIs the toolbar popup uses (see popup-preview.html).
//   ?mode=app|injected|devtools|enabled|unreachable|webstore   ?perm=deny   ?snapshot=0   ?theme=dark|light
// Not referenced by manifest.json.
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var mode = params.get("mode") || "devtools";
  var permDeny = params.get("perm") === "deny";
  var theme = params.get("theme");
  var ORIGIN = mode === "webstore" ? "https://chromewebstore.google.com" : "https://shop.example.com";
  var enabled = mode === "injected" || mode === "enabled";
  var granted = enabled;

  // prefers-color-scheme stand-in so ?theme= works in the preview.
  if (theme === "dark" || theme === "light") {
    var real = window.matchMedia.bind(window);
    window.matchMedia = function (q) {
      if (q === "(prefers-color-scheme: dark)") return { matches: theme === "dark", addEventListener: function () {} };
      return real(q);
    };
  }

  function later(fn, ms) { setTimeout(fn, ms || 120); }
  function status() {
    var engine = mode === "app" ? { mode: "app", engineVersion: "0.4.0", react: true, sessionId: "s1" } : mode === "injected" ? { mode: "injected", engineVersion: "0.4.0", react: false, sessionId: "s2" } : null;
    return {
      type: "POPUP_STATUS",
      tabId: 7,
      engine: engine,
      snapshot: engine && params.get("snapshot") !== "0" ? { score: 62, grade: "needs-improvement", insights: 5, insightCounts: { critical: 0, high: 2, medium: 2, low: 1 } } : null,
      panelOpen: false,
      injection: { origin: ORIGIN, enabled: enabled, granted: granted },
      restricted: mode === "webstore",
    };
  }
  function injection() { return { type: "INJECTION_STATUS", origin: ORIGIN, enabled: enabled, granted: granted }; }

  window.chrome = {
    runtime: {
      id: "preview",
      lastError: undefined,
      getManifest: function () { return { version: "0.4.0" }; },
      sendMessage: function (msg, cb) {
        later(function () {
          if (msg.type === "POPUP_STATUS_REQUEST") return cb(status());
          if (msg.type === "INJECTION_INTENT") return cb({ type: "OK" });
          if (msg.type === "ENABLE_INJECTION") {
            if (granted) { enabled = true; mode = "enabled"; }
            return cb(injection());
          }
          if (msg.type === "DISABLE_INJECTION") {
            enabled = false;
            if (msg.removePermission) granted = false;
            mode = "devtools";
            return cb(injection());
          }
          cb(undefined);
        });
      },
    },
    tabs: {
      query: function (q, cb) { later(function () { cb([{ id: 7 }]); }, 10); },
      sendMessage: function (tabId, msg, opts, cb) {
        later(function () {
          if (mode === "unreachable") {
            window.chrome.runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
            cb(undefined);
            window.chrome.runtime.lastError = undefined;
            return;
          }
          cb({ type: "PAGE_INFO", origin: ORIGIN, title: "Example shop" });
        }, 20);
      },
      reload: function () { console.info("[preview] tabs.reload"); },
    },
    permissions: {
      request: function () {
        return new Promise(function (resolve) { setTimeout(function () { granted = !permDeny; resolve(granted); }, 300); });
      },
    },
  };
})();
