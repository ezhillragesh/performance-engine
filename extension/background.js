const devtoolsPorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "devtools") {
    return;
  }

  let tabId = null;

  port.onMessage.addListener((message) => {
    if (message.type === "DEVTOOLS_INIT") {
      tabId = message.tabId;
      devtoolsPorts.set(tabId, port);
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

  const port = devtoolsPorts.get(tabId);
  if (port) {
    port.postMessage(message);
  }
});
