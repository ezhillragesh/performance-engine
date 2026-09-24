const issueList = document.getElementById("issueList");
const issueCount = document.getElementById("issueCount");
const emptyState = document.getElementById("emptyState");
const detailsPlaceholder = document.getElementById("detailsPlaceholder");
const detailsContent = document.getElementById("detailsContent");
const detailTitle = document.getElementById("detailTitle");
const detailSeverity = document.getElementById("detailSeverity");
const detailMessage = document.getElementById("detailMessage");
const detailCause = document.getElementById("detailCause");
const detailFix = document.getElementById("detailFix");
const detailConfidence = document.getElementById("detailConfidence");
const detailImpact = document.getElementById("detailImpact");
const timelineList = document.getElementById("timelineList");
const timelineCount = document.getElementById("timelineCount");
const timelineEmpty = document.getElementById("timelineEmpty");
const severityFilter = document.getElementById("severityFilter");
const searchInput = document.getElementById("searchInput");
const refreshBtn = document.getElementById("refreshBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const statTotal = document.getElementById("statTotal");
const statCritical = document.getElementById("statCritical");
const statHigh = document.getElementById("statHigh");
const statMedium = document.getElementById("statMedium");
const statLow = document.getElementById("statLow");
const traceSummary = document.getElementById("traceSummary");
const traceMeta = document.getElementById("traceMeta");

let insights = [];
let events = [];
let selectedId = null;
let selectedInsight = null;
let lastMessageAt = 0;
let reconnectAttempt = 0;
let port = null;

function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
  if (state === "live") {
    statusText.textContent = "Live";
  } else if (state === "reconnecting") {
    statusText.textContent = "Reconnecting…";
  } else {
    statusText.textContent = "Waiting for data";
  }
}

function onPortMessage(message) {
  if (!message || message.type !== "PERF_MESSAGE") {
    return;
  }

  reconnectAttempt = 0;
  lastMessageAt = Date.now();
  setStatus("live");

  const payload = message.payload;
  if (payload.type === "INSIGHTS_UPDATE") {
    insights = payload.payload;
    renderStats();
    renderIssues();
  }

  if (payload.type === "EVENTS_UPDATE") {
    events = payload.payload;
    renderTimeline(selectedInsight);
  }
}

function connect() {
  port = chrome.runtime.connect({ name: "devtools" });
  port.onMessage.addListener(onPortMessage);

  port.onDisconnect.addListener(() => {
    setStatus("reconnecting");
    // MV3 service workers can be terminated; re-establish the port so the
    // panel keeps receiving data without a manual reload.
    const delay = Math.min(1000 + reconnectAttempt * 500, 5000);
    reconnectAttempt += 1;
    setTimeout(connectAndInit, delay);
  });
}

function connectAndInit() {
  connect();
  if (!port) {
    return;
  }
  port.postMessage({ type: "DEVTOOLS_INIT", tabId: chrome.devtools.inspectedWindow.tabId });
  port.postMessage({ type: "REQUEST_SNAPSHOT" });
}

connectAndInit();

refreshBtn.addEventListener("click", () => {
  if (port) {
    port.postMessage({ type: "REQUEST_SNAPSHOT" });
  }
});

severityFilter.addEventListener("change", () => renderIssues());
searchInput.addEventListener("input", () => renderIssues());

// Keep the status honest when the inspected tab stops sending messages.
window.setInterval(() => {
  if (Date.now() - lastMessageAt > 10000) {
    setStatus("waiting");
  }
}, 3000);

function renderStats() {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const insight of insights) {
    const severity = insight.severity;
    if (counts[severity] !== undefined) {
      counts[severity] += 1;
    }
  }

  statTotal.textContent = String(insights.length);
  statCritical.textContent = String(counts.critical);
  statHigh.textContent = String(counts.high);
  statMedium.textContent = String(counts.medium);
  statLow.textContent = String(counts.low);
}

function renderIssues() {
  const severity = severityFilter.value;
  const query = searchInput.value.toLowerCase();

  const filtered = insights.filter((insight) => {
    const matchesSeverity = severity === "all" || insight.severity === severity;
    const matchesQuery =
      insight.source.toLowerCase().includes(query) ||
      insight.issueType.toLowerCase().includes(query) ||
      insight.message.toLowerCase().includes(query);
    return matchesSeverity && matchesQuery;
  });

  issueCount.textContent = String(filtered.length);
  emptyState.hidden = filtered.length > 0;
  issueList.hidden = filtered.length === 0;
  issueList.innerHTML = "";

  filtered.forEach((insight) => {
    const item = document.createElement("li");
    item.className = `issue-item${selectedId === getInsightKey(insight) ? " active" : ""}`;
    item.addEventListener("click", () => {
      selectedId = getInsightKey(insight);
      selectedInsight = insight;
      renderDetails(insight);
      renderIssues();
    });

    const header = document.createElement("div");
    header.className = "issue-header";

    const type = document.createElement("span");
    type.className = "issue-type";
    type.textContent = insight.issueType;

    const badge = document.createElement("span");
    badge.className = `severity ${insight.severity}`;
    badge.textContent = insight.severity;

    header.appendChild(type);
    header.appendChild(badge);

    const source = document.createElement("div");
    source.className = "issue-source";
    source.textContent = insight.source;

    const message = document.createElement("div");
    message.className = "issue-message";
    message.textContent = insight.message;

    const meta = document.createElement("div");
    meta.className = "issue-meta";
    meta.textContent = `~${Math.round(insight.impact.estimatedDelayMs)}ms · ${Math.round(insight.confidence * 100)}% confidence`;

    item.appendChild(header);
    item.appendChild(source);
    item.appendChild(message);
    item.appendChild(meta);
    issueList.appendChild(item);
  });

  if (!selectedId && filtered.length > 0) {
    selectedInsight = filtered[0];
    renderDetails(filtered[0]);
    selectedId = getInsightKey(filtered[0]);
  }

  if (filtered.length === 0) {
    selectedInsight = null;
    detailsContent.hidden = true;
    detailsPlaceholder.hidden = false;
  }
}

function renderDetails(insight) {
  detailsPlaceholder.hidden = true;
  detailsContent.hidden = false;

  detailTitle.textContent = insight.issueType;
  detailSeverity.textContent = insight.severity.toUpperCase();
  detailSeverity.className = `severity-chip severity ${insight.severity}`;
  detailMessage.textContent = insight.message;
  detailCause.textContent = insight.cause;
  detailFix.textContent = insight.possibleFix;
  detailConfidence.textContent = `${Math.round(insight.confidence * 100)}% confidence`;
  detailImpact.textContent = formatImpact(insight);

  // Show trace summary if traceId is available
  const traceId = insight.metadata?.traceId;
  if (traceId) {
    renderTraceSummary(insight, traceId);
    traceSummary.hidden = false;
  } else {
    traceSummary.hidden = true;
  }

  renderTimeline(insight);
}

function renderTraceSummary(insight, traceId) {
  // Find events belonging to this trace
  const traceEvents = events.filter((e) => e.traceId === traceId);
  const uiEvents = traceEvents.filter((e) => e.type === "ui");
  const renderEvents = traceEvents.filter((e) => e.type === "render");
  const networkEvents = traceEvents.filter((e) => e.type === "network");

  const traceStart = Math.min(...traceEvents.map((e) => e.timestamp));
  const traceEnd = Math.max(...traceEvents.map((e) => e.timestamp));
  const duration = Math.round(traceEnd - traceStart);

  const trigger = uiEvents[0]?.target ?? "unknown";
  const triggerType = uiEvents[0]?.eventType ?? "interaction";

  const affectedComponents = insight.metadata?.affectedComponents ?? [];
  const renderCount = insight.metadata?.renderCount ?? renderEvents.length;

  traceMeta.innerHTML = "";

  const metaItems = [
    { label: "Interaction", value: `${triggerType}: "${trigger}"`, className: "" },
    { label: "Duration", value: `${duration}ms`, className: "highlight" },
    { label: "Events", value: String(traceEvents.length), className: "" },
    { label: "UI Events", value: String(uiEvents.length), className: "" },
    { label: "Renders", value: String(renderEvents.length), className: "" },
    { label: "Network", value: String(networkEvents.length), className: "" },
  ];

  if (insight.impact?.estimatedDelayMs !== undefined) {
    metaItems.push({ label: "Est. Delay", value: `${Math.round(insight.impact.estimatedDelayMs)}ms`, className: "warning" });
  }
  if (insight.impact?.renderCostMs !== undefined) {
    metaItems.push({ label: "Render Cost", value: `~${Math.round(insight.impact.renderCostMs)}ms`, className: "warning" });
  }
  if (insight.confidence !== undefined) {
    metaItems.push({ label: "Confidence", value: `${Math.round(insight.confidence * 100)}%`, className: "highlight" });
  }

  for (const item of metaItems) {
    const div = document.createElement("div");
    div.className = "trace-meta-item";
    div.innerHTML = `
      <div class="trace-meta-label">${item.label}</div>
      <div class="trace-meta-value ${item.className}">${item.value}</div>
    `;
    traceMeta.appendChild(div);
  }

  // Store trace info for timeline rendering
  traceSummary.dataset.traceId = traceId;
  traceSummary.dataset.traceStart = String(traceStart);
}

function renderTimeline(insight) {
  const traceId = insight.metadata?.traceId;
  const traceStart = traceId ? Number(traceSummary.dataset.traceStart) : undefined;
  const windowStart = insight?.metadata?.timeWindowStart;
  const windowEnd = insight?.metadata?.timeWindowEnd;

  let filteredEvents = events;

  // Prefer traceId filtering over time window for causal trace
  if (traceId) {
    filteredEvents = events.filter((event) => event.traceId === traceId);
  } else if (windowStart !== undefined && windowEnd !== undefined) {
    filteredEvents = events.filter((event) => event.timestamp >= windowStart && event.timestamp <= windowEnd);
  }

  // Sort by timestamp
  filteredEvents.sort((a, b) => a.timestamp - b.timestamp);

  timelineList.innerHTML = "";
  timelineCount.textContent = String(filteredEvents.length);
  timelineEmpty.hidden = filteredEvents.length > 0;

  // Determine relevant events for highlighting
  const affectedComponents = new Set(insight.metadata?.affectedComponents ?? []);
  const relevantNetworkUrl = insight.source;
  const isNetworkIssue = insight.issueType === "network-blocking-render";

  filteredEvents.slice(0, 50).forEach((event) => {
    const item = document.createElement("li");
    item.className = "timeline-item";

    // Highlight relevant events
    let isRelevant = false;
    if (event.type === "render" && affectedComponents.has(event.componentName)) {
      isRelevant = true;
    } else if (event.type === "network" && isNetworkIssue && event.url.includes(relevantNetworkUrl)) {
      isRelevant = true;
    } else if (event.type === "ui") {
      // Always highlight the trigger event
      isRelevant = true;
    }
    if (isRelevant) {
      item.classList.add("highlighted");
    }

    const badge = document.createElement("span");
    badge.className = `timeline-badge ${event.type}`;
    badge.textContent = event.type.toUpperCase();

    const text = document.createElement("span");
    text.className = "timeline-text";
    text.textContent = formatEvent(event);

    // Add relative timing for trace events
    if (traceStart !== undefined && traceStart > 0) {
      const relativeMs = Math.round(event.timestamp - traceStart);
      const relativeSpan = document.createElement("span");
      relativeSpan.className = "trace-event-relative";
      relativeSpan.textContent = `+${relativeMs}ms`;
      item.appendChild(badge);
      item.appendChild(text);
      item.appendChild(relativeSpan);
    } else {
      item.appendChild(badge);
      item.appendChild(text);
    }

    timelineList.appendChild(item);
  });
}

function formatImpact(insight) {
  const delay = Math.round(insight.impact.estimatedDelayMs);
  const renderCost = insight.impact.renderCostMs ? `, render cost ~${Math.round(insight.impact.renderCostMs)}ms` : "";
  return `Estimated delay ~${delay}ms${renderCost}`;
}

function formatEvent(event) {
  if (event.type === "ui") {
    return `${formatTimestamp(event.timestamp)} ${event.eventType} on ${event.target}`;
  }
  if (event.type === "render") {
    const duration = event.durationMs ? ` · ${event.durationMs}ms` : "";
    return `${formatTimestamp(event.timestamp)} ${event.componentName}${duration}`;
  }
  return `${formatTimestamp(event.timestamp)} ${event.url} (${event.duration}ms)`;
}

function formatTimestamp(timestamp) {
  return `${Math.round(timestamp)}ms`;
}

function getInsightKey(insight) {
  const start = insight.metadata?.timeWindowStart ?? 0;
  const end = insight.metadata?.timeWindowEnd ?? 0;
  return `${insight.issueType}-${insight.source}-${start}-${end}`;
}
