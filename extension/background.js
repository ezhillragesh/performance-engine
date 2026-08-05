const devtoolsPorts = new Map();

/** Latest payload per tab, replayed when DevTools connects late. */
const tabState = new Map();

function getTabState(tabId) {
  if (!tabState.has(tabId)) {
    tabState.set(tabId, { insights: null, events: null });
  }
  return tabState.get(tabId);
}

function forwardToDevTools(tabId, message) {
  const port = devtoolsPorts.get(tabId);
  if (port) {
    port.postMessage(message);
    return true;
  }
  return false;
}

function storeAndForward(tabId, payload) {
  const state = getTabState(tabId);

  if (payload.type === "INSIGHTS_UPDATE") {
    state.insights = payload;
  } else if (payload.type === "EVENTS_UPDATE") {
    state.events = payload;
  }

  return forwardToDevTools(tabId, { type: "PERF_MESSAGE", payload });
}

function replayTabState(tabId) {
  const state = tabState.get(tabId);
  if (!state) {
    return;
  }

  if (state.insights) {
    forwardToDevTools(tabId, { type: "PERF_MESSAGE", payload: state.insights });
  }
  if (state.events) {
    forwardToDevTools(tabId, { type: "PERF_MESSAGE", payload: state.events });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools") {
    return;
  }

  let tabId = null;

  port.onMessage.addListener((message) => {
    if (message.type === "DEVTOOLS_INIT") {
      tabId = message.tabId;
      devtoolsPorts.set(tabId, port);
      replayTabState(tabId);
    }

    if (message.type === "REQUEST_SNAPSHOT" && tabId !== null) {
      replayTabState(tabId);
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId !== null) {
      devtoolsPorts.delete(tabId);
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type !== "PERF_MESSAGE") {
    return;
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined) {
    return;
  }

  storeAndForward(tabId, message.payload);
});
