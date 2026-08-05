const issueList = document.getElementById("issueList");
const issueCount = document.getElementById("issueCount");
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
const severityFilter = document.getElementById("severityFilter");
const searchInput = document.getElementById("searchInput");

let insights = [];
let events = [];
let selectedId = null;
let selectedInsight = null;

const port = chrome.runtime.connect({ name: "devtools" });
port.postMessage({ type: "DEVTOOLS_INIT", tabId: chrome.devtools.inspectedWindow.tabId });
port.postMessage({ type: "REQUEST_SNAPSHOT" });

port.onMessage.addListener((message) => {
  if (message.type !== "PERF_MESSAGE") {
    return;
  }

  const payload = message.payload;
  if (payload.type === "INSIGHTS_UPDATE") {
    insights = payload.payload;
    renderIssues();
  }

  if (payload.type === "EVENTS_UPDATE") {
    events = payload.payload;
    renderTimeline(selectedInsight);
  }
});

severityFilter.addEventListener("change", () => renderIssues());
searchInput.addEventListener("input", () => renderIssues());

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

    item.appendChild(header);
    item.appendChild(source);
    item.appendChild(message);
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

  renderTimeline(insight);
}

function renderTimeline(insight) {
  const windowStart = insight?.metadata?.timeWindowStart;
  const windowEnd = insight?.metadata?.timeWindowEnd;

  let filteredEvents = events;
  if (windowStart !== undefined && windowEnd !== undefined) {
    filteredEvents = events.filter((event) => event.timestamp >= windowStart && event.timestamp <= windowEnd);
  }

  timelineList.innerHTML = "";
  timelineCount.textContent = String(filteredEvents.length);

  filteredEvents.slice(0, 40).forEach((event) => {
    const item = document.createElement("li");
    item.className = "timeline-item";
    item.textContent = formatEvent(event);
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
    return `${formatTimestamp(event.timestamp)} UI: ${event.eventType} on ${event.target}`;
  }
  if (event.type === "render") {
    const duration = event.durationMs ? ` (${event.durationMs}ms)` : "";
    return `${formatTimestamp(event.timestamp)} Render: ${event.componentName}${duration}`;
  }
  return `${formatTimestamp(event.timestamp)} Network: ${event.url} (${event.duration}ms)`;
}

function formatTimestamp(timestamp) {
  return `${Math.round(timestamp)}ms`;
}

function getInsightKey(insight) {
  const start = insight.metadata?.timeWindowStart ?? 0;
  const end = insight.metadata?.timeWindowEnd ?? 0;
  return `${insight.issueType}-${insight.source}-${start}-${end}`;
}
