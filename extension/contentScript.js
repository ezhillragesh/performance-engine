// Classic content script (no modules). Bridges page <-> extension for the top frame only.
(function () {
  "use strict";

  if (window.top !== window) return; // iframe policy: top frame only

  var PAGE_SOURCE = "perf-engine";
  var PANEL_SOURCE = "perf-engine-devtools";
  var active = true;

  function alive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // After an extension reload/update this script is orphaned: its context is invalidated.
  // Tell the page to stop streaming: nobody can receive its snapshots any more, and a
  // reloaded extension does not re-inject into already-open tabs.
  function teardown() {
    if (!active) return;
    active = false;
    window.removeEventListener("message", onPageMessage);
    try {
      window.postMessage({ source: PANEL_SOURCE, version: 2, type: "COMMAND", command: "DETACH" }, "*");
    } catch (e) {
      /* ignore */
    }
    try {
      chrome.runtime.onMessage.removeListener(onRuntimeMessage);
    } catch (e) {
      /* context already gone */
    }
  }

  function onPageMessage(event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.source !== PAGE_SOURCE || typeof data.type !== "string") return;
    if (!alive()) return teardown();
    try {
      var p = chrome.runtime.sendMessage({ type: "PERF_MESSAGE", payload: data });
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {
      teardown();
    }
  }

  function onRuntimeMessage(message) {
    if (!message || message.type !== "PANEL_COMMAND" || typeof message.command !== "string") return;
    window.postMessage(
      { source: PANEL_SOURCE, version: 2, type: "COMMAND", command: message.command, payload: message.payload },
      "*",
    );
  }

  window.addEventListener("message", onPageMessage);
  try {
    chrome.runtime.onMessage.addListener(onRuntimeMessage);
  } catch (e) {
    teardown();
  }
})();
