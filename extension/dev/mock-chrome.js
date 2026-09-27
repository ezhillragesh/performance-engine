// Dev-only stub of the chrome.* APIs the panel uses, driven by dev/fixture.js.
// Query params:
//   ?theme=dark|light
//   ?mode=app|injected|devtools   engine mode (default app). ?state=noengine is an alias for devtools.
//   ?perm=deny                    chrome.permissions.request resolves false
// Console helpers: previewControls.navigate(), .disconnect(), .reset(), .setMode("app"|"injected"|"devtools")
// Accessibility tab: every other inspectedWindow.eval expression runs inside an off-screen iframe
// showing dev/a11y-fixture.html, so the real vendor/a11y-audit.js — and the real vendored
// vendor/ibm-ace.js and vendor/axe.min.js, injected wrapped by the view — audit a broken fixture DOM.
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var theme = params.get("theme");
  var mode = params.get("mode") || (params.get("state") === "noengine" ? "devtools" : "app");
  if (mode !== "injected" && mode !== "devtools") mode = "app";
  var permDeny = params.get("perm") === "deny";

  function makeEvent() {
    var ls = [];
    return {
      addListener: function (f) { ls.push(f); },
      removeListener: function (f) { ls = ls.filter(function (x) { return x !== f; }); },
      hasListener: function (f) { return ls.indexOf(f) >= 0; },
      _emit: function () { var args = arguments; ls.slice().forEach(function (f) { f.apply(null, args); }); },
    };
  }

  // Structured-clone-ish copy, like real extension messaging.
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function storageArea(prefix) {
    var key = function (k) { return "mock-chrome." + prefix + "." + k; };
    return {
      get: function (keys) {
        var list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
        var out = {};
        list.forEach(function (k) {
          var raw = localStorage.getItem(key(k));
          if (raw !== null) out[k] = JSON.parse(raw);
        });
        return Promise.resolve(out);
      },
      set: function (items) {
        Object.keys(items).forEach(function (k) { localStorage.setItem(key(k), JSON.stringify(items[k])); });
        return Promise.resolve();
      },
      remove: function (keys) {
        (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { localStorage.removeItem(key(k)); });
        return Promise.resolve();
      },
    };
  }

  var gen = window.PerfFixture.create();
  var dt = window.PerfFixture.createDevtools();
  var ports = [];
  var timer = null;
  var granted = mode === "injected";
  var hasEngine = function () { return mode !== "devtools"; };

  function send(port, msg) {
    setTimeout(function () { if (port._open) port.onMessage._emit(clone(msg)); }, 5);
  }
  function broadcast(msg) { ports.forEach(function (p) { send(p, msg); }); }
  function page(msg) { broadcast({ type: "PERF_MESSAGE", payload: msg }); }

  function startStreaming() {
    if (timer || !hasEngine()) return;
    timer = setInterval(function () {
      if (gen.tick()) page(gen.snapshot()); // only when data changed, like the real bridge
    }, 1000);
  }

  function handleCommand(command, payload) {
    if (!hasEngine()) return; // no engine: PING goes unanswered
    switch (command) {
      case "PING": page(gen.hello(mode)); break;
      case "ATTACH": startStreaming(); page(gen.snapshot()); break;
      case "DETACH": clearInterval(timer); timer = null; break;
      case "REQUEST_SNAPSHOT": page(gen.snapshot()); break;
      case "PAUSE": gen.setPaused(true); page(gen.snapshot()); break;
      case "RESUME": gen.setPaused(false); page(gen.snapshot()); break;
      case "CLEAR": gen.clear(); page(gen.reset()); page(gen.snapshot()); break;
      case "SET_BUDGETS": gen.setBudgets(payload); page(gen.snapshot()); break;
    }
  }

  function injectionStatus(origin) {
    return { type: "INJECTION_STATUS", origin: origin, enabled: mode === "injected", granted: granted };
  }

  // Simulates background: register/unregister the injected script, then reload the tab.
  function reloadAs(nextMode) {
    mode = nextMode;
    navigate();
  }

  function connect(info) {
    var port = {
      name: (info && info.name) || "",
      _open: true,
      onMessage: makeEvent(),
      onDisconnect: makeEvent(),
      postMessage: function (msg) {
        if (!port._open) throw new Error("Attempting to use a disconnected port object");
        msg = clone(msg);
        setTimeout(function () {
          if (msg.type === "DEVTOOLS_INIT") {
            send(port, { type: "CONNECTION", engineDetected: hasEngine() });
            if (!hasEngine()) return;
            send(port, { type: "PERF_MESSAGE", payload: gen.hello(mode) });
            handleCommand("ATTACH");
          } else if (msg.type === "REQUEST_SNAPSHOT") {
            handleCommand("REQUEST_SNAPSHOT");
          } else if (msg.type === "PANEL_COMMAND") {
            handleCommand(msg.command, msg.payload);
          } else if (msg.type === "INJECTION_STATUS_REQUEST") {
            send(port, injectionStatus(msg.origin));
          } else if (msg.type === "ENABLE_INJECTION") {
            if (!granted) return send(port, { type: "INJECTION_STATUS", origin: msg.origin, enabled: false, granted: false, error: "Host permission missing" });
            mode = "injected";
            send(port, injectionStatus(msg.origin));
            setTimeout(function () { reloadAs("injected"); }, 400);
          } else if (msg.type === "DISABLE_INJECTION") {
            mode = "devtools";
            send(port, injectionStatus(msg.origin));
            setTimeout(function () { reloadAs("devtools"); }, 400);
          }
        }, 5);
      },
      disconnect: function () { port._open = false; },
    };
    ports.push(port);
    return port;
  }

  // ── chrome.devtools.network / inspectedWindow (DevTools-only layer) ──

  var onNavigated = makeEvent();
  var onRequestFinished = makeEvent();
  setInterval(function () {
    dt.tick().forEach(function (entry) { onRequestFinished._emit(entry); });
  }, 1500);

  // Stand-in for the inspected page: a same-origin iframe with the broken-markup fixture.
  var frame = null;
  var frameReady = null;
  function inspectedFrame() {
    if (frameReady) return frameReady;
    frameReady = new Promise(function (resolve) {
      frame = document.createElement("iframe");
      frame.title = "Preview inspected page (a11y fixture)";
      frame.setAttribute("aria-hidden", "true");
      frame.tabIndex = -1;
      frame.style.cssText = "position:fixed;left:-12000px;top:0;width:1024px;height:768px;border:0;";
      frame.addEventListener("load", function () {
        var w = frame.contentWindow;
        // DevTools Console Utilities available to inspectedWindow.eval.
        w.inspect = function (el) { w.__previewInspected = el; console.info("[preview] inspect()", el); };
        resolve(w);
      });
      frame.src = "./a11y-fixture.html";
      document.body.appendChild(frame);
    });
    return frameReady;
  }
  function reloadInspectedFrame() {
    if (!frame) return;
    frameReady = null;
    frame.remove();
    frame = null;
  }

  function evalInFrame(expr, cb) {
    inspectedFrame().then(function (w) {
      var result;
      try {
        result = w.eval(expr);
      } catch (e) {
        return cb(undefined, { isException: true, value: String(e && e.message ? e.message : e) });
      }
      try {
        cb(result === undefined ? undefined : clone(result));
      } catch (e) {
        cb(undefined, { isError: true, code: "E_NOTSERIALIZABLE", description: "Result is not serializable" });
      }
    });
  }

  function evalInPage(expression, options, callback) {
    if (typeof options === "function") callback = options;
    var cb = typeof callback === "function" ? callback : function () {};
    var expr = String(expression);
    setTimeout(function () {
      if (expr.indexOf("/*perf-intel:install*/") === 0) {
        cb({ installed: true, fresh: false, v: 1, timeOrigin: dt.read(0).timeOrigin });
      } else if (expr.indexOf("/*perf-intel:poll*/") === 0) {
        var m = /c\.read\((\d+)\)/.exec(expr);
        cb(dt.read(m ? Number(m[1]) : 0));
      } else if (expr === "location.origin") {
        cb(dt.origin);
      } else {
        evalInFrame(expr, cb); // Accessibility audit, inspect(), highlight
      }
    }, 10);
  }

  var mock = {
    runtime: { id: "preview", lastError: undefined, connect: connect, getURL: function (p) { return "/" + p; } },
    devtools: {
      inspectedWindow: { tabId: 1, eval: evalInPage },
      panels: { themeName: theme === "dark" ? "dark" : theme === "light" ? "default" : undefined },
      network: {
        onNavigated: onNavigated,
        onRequestFinished: onRequestFinished,
        getHAR: function (cb) { setTimeout(function () { cb(clone(dt.getHAR())); }, 10); },
      },
    },
    permissions: {
      request: function () {
        granted = !permDeny;
        return new Promise(function (resolve) { setTimeout(function () { resolve(granted); }, 300); });
      },
      contains: function () { return Promise.resolve(granted); },
    },
    storage: { local: storageArea("local"), session: storageArea("session") },
  };

  try { window.chrome = mock; } catch (e) { /* ignore */ }
  if (window.chrome !== mock) Object.defineProperty(window, "chrome", { value: mock, configurable: true, writable: true });

  function navigate() {
    clearInterval(timer);
    timer = null;
    broadcast({ type: "TAB_NAVIGATED", url: dt.origin + "/inbox" });
    onNavigated._emit(dt.origin + "/inbox");
    dt = window.PerfFixture.createDevtools();
    reloadInspectedFrame();
    setTimeout(function () {
      gen = window.PerfFixture.create();
      if (!hasEngine()) return;
      page(gen.hello(mode));
      handleCommand("ATTACH");
    }, 1200);
  }

  window.previewControls = {
    navigate: navigate,
    setMode: function (m) { reloadAs(m === "injected" || m === "devtools" ? m : "app"); },
    disconnect: function () {
      ports.forEach(function (p) { p._open = false; p.onDisconnect._emit(p); });
      ports = [];
    },
    reset: function () { localStorage.clear(); location.reload(); },
  };
})();
