window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  if (data.source !== "perf-engine" || typeof data.type !== "string") {
    return;
  }

  try {
    chrome.runtime.sendMessage({
      type: "PERF_MESSAGE",
      payload: data,
    });
  } catch {
    // Extension context invalidated (reload/update) — ignore.
  }
});
