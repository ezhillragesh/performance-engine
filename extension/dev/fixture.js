// Dev-only: generates realistic protocol-v2 HELLO / SNAPSHOT payloads (and DevTools-layer HAR +
// collector data for ?mode=devtools) for dev/preview.html.
// Classic script; exposes window.PerfFixture. Not referenced by manifest.json.
(function () {
  "use strict";

  // Pretend the page has been running for a minute so seeded history has positive timestamps.
  var OFFSET = 60000;
  var now = function () { return performance.now() + OFFSET; };
  var timeOrigin = performance.timeOrigin - OFFSET;

  var DEFAULT_BUDGETS = {
    interactionLatencyMs: 200,
    longTaskMs: 50,
    componentRenderMs: 16,
    rendersPerInteraction: 25,
    networkRequestMs: 1000,
    wastedRenderPct: 30,
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function round(n, d) { var m = Math.pow(10, d || 1); return Math.round(n * m) / m; }

  function create() {
    var sessionId = "sess-" + Math.random().toString(36).slice(2, 10);
    var seq = 0;
    var commit = 0;
    var events = [];
    var traces = [];
    var dropped = 0;
    var paused = false;
    var budgets = Object.assign({}, DEFAULT_BUDGETS);
    var lastTraceAt = 0;
    var capturedAt = now();

    function id(prefix) { seq += 1; return prefix + "-" + seq.toString(36); }

    function push(ev) {
      ev.sessionId = sessionId;
      events.push(ev);
      return ev;
    }

    var TRIGGERS = [
      { eventType: "click", target: "button#search.primary", label: "Search" },
      { eventType: "click", target: "button.star", label: "Star message" },
      { eventType: "keydown", target: "input#query", label: "Search messages" },
      { eventType: "click", target: "input#sync[type=checkbox]", label: "Toggle sync" },
      { eventType: "click", target: "a.nav-item", label: "Inbox" },
    ];
    var ENDPOINTS = ["/api/messages?q=perf", "/api/messages/star", "/api/search?q=re", "/api/sync", "/api/folders/inbox"];

    function makeTrace(start) {
      var trig = pick(TRIGGERS);
      var traceId = id("trace");
      var spans = [];
      var ids = [];
      var components = {};
      var renderCount = 0;
      var t = start;

      var ui = push({ type: "ui", eventId: id("ui"), traceId: traceId, timestamp: t, eventType: trig.eventType, target: trig.target, label: trig.label, domTimestamp: t - rand(1, 12), startsTrace: true });
      ids.push(ui.eventId);

      var heavy = Math.random() < 0.45;
      var ltDur = heavy ? rand(90, 320) : rand(52, 110);
      var latency = ltDur + rand(20, 90);
      var inter = push({
        type: "interaction", eventId: id("int"), traceId: traceId, timestamp: t, name: trig.eventType === "keydown" ? "keydown" : "pointerup",
        interactionId: seq, duration: round(latency, 0), inputDelay: round(rand(2, 20)), processingMs: round(ltDur * 0.8), presentationDelay: round(latency - ltDur * 0.8 - 5), target: trig.target,
      });
      ids.push(inter.eventId);
      var spInt = { id: traceId + ":int", kind: "interaction", label: trig.eventType + " " + trig.label, start: t, end: t + latency, eventId: inter.eventId };
      spans.push(spInt);

      var lt = push({
        type: "longtask", eventId: id("lt"), traceId: traceId, timestamp: t + 2, duration: round(ltDur), blockingDuration: round(Math.max(0, ltDur - 50)), api: "long-animation-frame",
        scripts: [{ invoker: trig.target.toUpperCase().split(".")[0] + ".on" + trig.eventType, sourceURL: "/src/App.tsx", sourceFunctionName: "handle" + trig.label.replace(/\s/g, ""), duration: round(ltDur * 0.9) }],
      });
      ids.push(lt.eventId);
      spans.push({ id: traceId + ":lt", kind: "longtask", label: "Handler " + lt.scripts[0].invoker, start: lt.timestamp, end: lt.timestamp + lt.duration, parentId: spInt.id, eventId: lt.eventId });

      // Synchronous commit inside the handler (optimistic UI).
      commit += 1;
      var c1Start = t + 4 + ltDur * 0.6;
      var spC1 = { id: traceId + ":c1", kind: "commit", label: "Commit #" + commit, start: c1Start, end: c1Start + 6, parentId: traceId + ":lt" };
      spans.push(spC1);
      [["SearchBar", 1.2, false], ["MessageList", 6, false], ["Header", 0.8, true]].forEach(function (r) {
        var ev = push({ type: "render", eventId: id("r"), traceId: traceId, timestamp: c1Start + rand(0, 3), componentName: r[0], durationMs: round(r[1] * rand(0.6, 1.4), 2), phase: "update", source: "react-profiler", commitId: commit, wasted: r[2], changedProps: r[2] ? [] : ["query"], stateChanged: !r[2] });
        ids.push(ev.eventId);
        components[r[0]] = 1;
        renderCount += 1;
        spans.push({ id: traceId + ":" + ev.eventId, kind: "render", label: r[0], start: ev.timestamp, end: ev.timestamp + ev.durationMs, parentId: spC1.id, eventId: ev.eventId });
      });

      // Network request fired by the handler.
      var netStart = lt.timestamp + ltDur * 0.3;
      var failed = Math.random() < 0.12;
      var netDur = failed ? rand(300, 1400) : rand(90, heavy ? 1300 : 500);
      var status = failed ? pick([500, 503, 0, 404]) : 200;
      var url = pick(ENDPOINTS);
      var net = push({
        type: "network", eventId: id("net"), traceId: traceId, timestamp: netStart, url: url, method: url.indexOf("star") >= 0 ? "POST" : "GET",
        duration: round(netDur), endTime: netStart + netDur, status: status, fromCache: false, responseSize: status === 200 ? Math.round(rand(800, 64000)) : undefined,
        initiator: "fetch", error: status === 0 ? "Failed to fetch" : undefined,
      });
      ids.push(net.eventId);
      spans.push({ id: traceId + ":net", kind: "network", label: net.method + " " + url, start: netStart, end: netStart + netDur, parentId: spInt.id, eventId: net.eventId, detail: "HTTP " + (status || "ERR") });

      // Response commit: list re-render burst.
      commit += 1;
      var c2Start = netStart + netDur + 3;
      var spC2 = { id: traceId + ":c2", kind: "commit", label: "Commit #" + commit, start: c2Start, end: c2Start + 20, parentId: traceId + ":net" };
      spans.push(spC2);
      var rows = heavy ? Math.round(rand(18, 34)) : Math.round(rand(4, 12));
      var cursor = c2Start;
      var list = push({ type: "render", eventId: id("r"), traceId: traceId, timestamp: cursor, componentName: "MessageList", durationMs: round(heavy ? rand(14, 38) : rand(4, 12), 2), phase: "update", source: "react-profiler", commitId: commit, changedProps: ["messages"], stateChanged: true });
      ids.push(list.eventId);
      renderCount += 1;
      components.MessageList = 1;
      spans.push({ id: traceId + ":" + list.eventId, kind: "render", label: "MessageList", start: list.timestamp, end: list.timestamp + list.durationMs, parentId: spC2.id, eventId: list.eventId });
      for (var i = 0; i < rows; i++) {
        cursor += rand(0.2, 1.1);
        var wasted = Math.random() < 0.4;
        var row = push({ type: "render", eventId: id("r"), traceId: traceId, timestamp: cursor, componentName: "MessageRow", instanceId: "row-" + i, durationMs: round(rand(0.3, 2.4), 2), phase: i > rows - 3 ? "mount" : "update", source: "react-profiler", commitId: commit, parentComponent: "MessageList", wasted: wasted, changedProps: wasted ? [] : ["message"] });
        ids.push(row.eventId);
        renderCount += 1;
        if (i < 6) spans.push({ id: traceId + ":" + row.eventId, kind: "render", label: "MessageRow #" + i, start: row.timestamp, end: row.timestamp + row.durationMs, parentId: traceId + ":" + list.eventId, eventId: row.eventId });
      }
      components.MessageRow = 1;
      var side = push({ type: "render", eventId: id("r"), traceId: traceId, timestamp: cursor + 1, componentName: "Sidebar", durationMs: round(rand(1, 4), 2), phase: "update", source: "react-profiler", commitId: commit, wasted: true, changedProps: [] });
      ids.push(side.eventId);
      renderCount += 1;
      components.Sidebar = 1;
      spans.push({ id: traceId + ":" + side.eventId, kind: "render", label: "Sidebar", start: side.timestamp, end: side.timestamp + side.durationMs, parentId: spC2.id, eventId: side.eventId });
      spC2.end = cursor + 6;

      var end = Math.max(spC2.end, spInt.end);
      var trace = {
        traceId: traceId,
        trigger: { eventType: trig.eventType, target: trig.target, label: trig.label, timestamp: t },
        start: t, end: end, durationMs: round(end - t), latencyMs: inter.duration,
        renderCount: renderCount, networkCount: 1, longTaskMs: lt.duration,
        components: Object.keys(components), eventIds: ids, insightIds: [], spans: spans,
        _heavy: heavy, _net: net, _lt: lt, _inter: inter, _list: list, _failed: failed,
      };
      traces.push(trace);
      return trace;
    }

    function background(t) {
      // 1.2s auto-refresh churn: Clock + Sidebar re-render with no trace.
      commit += 1;
      push({ type: "render", eventId: id("r"), timestamp: t, componentName: "Clock", durationMs: round(rand(0.2, 0.8), 2), phase: "update", source: "react-profiler", commitId: commit, stateChanged: true, changedProps: [] });
      push({ type: "render", eventId: id("r"), timestamp: t + 0.6, componentName: "Sidebar", durationMs: round(rand(1, 3), 2), phase: "update", source: "react-profiler", commitId: commit, wasted: true, changedProps: [] });
      if (Math.random() < 0.25) {
        var d = rand(40, 180);
        push({ type: "network", eventId: id("net"), timestamp: t + 2, url: "/api/poll", method: "GET", duration: round(d), endTime: t + 2 + d, status: 200, fromCache: Math.random() < 0.3, responseSize: 312, initiator: "xhr" });
      }
    }

    function trim() {
      events.sort(function (a, b) { return a.timestamp - b.timestamp; });
      if (events.length > 1500) {
        dropped += events.length - 1500;
        events = events.slice(-1500);
      }
      if (traces.length > 100) traces = traces.slice(-100);
    }

    function seed() {
      var t = now() - 45000;
      while (t < now() - 1500) {
        background(t);
        if (t - lastTraceAt > 3500 && Math.random() < 0.5) {
          makeTrace(t + 100);
          lastTraceAt = t;
        }
        t += 1200;
      }
      trim();
    }

    function tick() {
      if (paused) return false;
      var t = now() - 1400;
      background(t);
      if (now() - lastTraceAt > 2500 && Math.random() < 0.55) {
        makeTrace(t - 50);
        lastTraceAt = now();
      }
      trim();
      capturedAt = now();
      return true;
    }

    // ── Insights + summary ──────────────────────────────────────────

    function latestBy(pred) {
      for (var i = traces.length - 1; i >= 0; i--) if (pred(traces[i])) return traces[i];
      return null;
    }

    function insights() {
      traces.forEach(function (tr) { tr.insightIds = []; });
      var out = [];
      function add(ins, trace) {
        if (trace) {
          ins.traceId = trace.traceId;
          trace.insightIds.push(ins.id);
          ins.metadata = Object.assign({ timeWindowStart: trace.start, timeWindowEnd: trace.end, traceId: trace.traceId, interactionType: trace.trigger.eventType, affectedComponents: trace.components }, ins.metadata || {});
        }
        out.push(ins);
      }
      var slow = latestBy(function (t) { return t.latencyMs > budgets.interactionLatencyMs; });
      if (slow) {
        add({
          id: "slow-interaction:" + slow.trigger.target, issueType: "slow-interaction", category: "interaction",
          severity: slow.latencyMs > 400 ? "critical" : "high", source: slow.trigger.target,
          message: "“" + slow.trigger.label + "” took " + Math.round(slow.latencyMs) + "ms from input to next paint.",
          cause: "A " + Math.round(slow._lt.duration) + "ms long task in the " + slow.trigger.eventType + " handler blocked the main thread before the frame could be presented.",
          possibleFix: "Split the handler: update the UI optimistically, then defer the expensive work with scheduler.yield() or startTransition.",
          confidence: 0.88, impact: { estimatedDelayMs: Math.round(slow.latencyMs - budgets.interactionLatencyMs), renderCostMs: round(slow._list.durationMs) },
          evidence: [
            { kind: "measurement", label: "Interaction latency (Event Timing)", value: slow.latencyMs, unit: "ms", threshold: budgets.interactionLatencyMs, eventIds: [slow._inter.eventId], weight: 0.45 },
            { kind: "correlation", label: "Long task overlaps the handler", value: slow._lt.duration, unit: "ms", threshold: budgets.longTaskMs, eventIds: [slow._lt.eventId], weight: 0.3 },
            { kind: "measurement", label: "Processing time", value: slow._inter.processingMs, unit: "ms", eventIds: [slow._inter.eventId], weight: 0.13 },
          ],
        }, slow);
      }
      var lt = latestBy(function (t) { return t._lt.blockingDuration > 80; });
      if (lt) {
        add({
          id: "long-task:" + lt._lt.scripts[0].invoker, issueType: "long-task", category: "main-thread", severity: lt._lt.duration > 200 ? "high" : "medium",
          source: lt._lt.scripts[0].invoker, message: "Main thread blocked for " + Math.round(lt._lt.duration) + "ms (" + Math.round(lt._lt.blockingDuration) + "ms blocking).",
          cause: "Script " + lt._lt.scripts[0].sourceFunctionName + " in " + lt._lt.scripts[0].sourceURL + " ran without yielding.",
          possibleFix: "Chunk the work or move it to a Web Worker.", confidence: 0.92, impact: { estimatedDelayMs: Math.round(lt._lt.blockingDuration) },
          evidence: [
            { kind: "measurement", label: "Long animation frame duration", value: lt._lt.duration, unit: "ms", threshold: budgets.longTaskMs, eventIds: [lt._lt.eventId], weight: 0.6 },
            { kind: "heuristic", label: "Attributed script", value: lt._lt.scripts[0].invoker, eventIds: [lt._lt.eventId], weight: 0.32 },
          ],
        }, lt);
      }
      var nb = latestBy(function (t) { return t._net.duration > 450; });
      if (nb) {
        add({
          id: "network-blocking-render:" + nb._net.url.split("?")[0], issueType: "network-blocking-render", category: "network", severity: nb._net.duration > 900 ? "high" : "medium",
          source: nb._net.url, message: "MessageList waited " + Math.round(nb._net.duration) + "ms for " + nb._net.method + " " + nb._net.url + " before rendering results.",
          cause: "The list only renders after the request resolves; there is no cached or streaming state.", possibleFix: "Render cached results immediately and revalidate (stale-while-revalidate), or show a skeleton.",
          confidence: 0.74, impact: { estimatedDelayMs: Math.round(nb._net.duration) },
          evidence: [
            { kind: "measurement", label: "Request duration", value: nb._net.duration, unit: "ms", threshold: 400, eventIds: [nb._net.eventId], weight: 0.4 },
            { kind: "correlation", label: "Render commit starts after response", value: 3, unit: "ms", eventIds: [nb._net.eventId, nb._list.eventId], weight: 0.34 },
          ],
          metadata: { rootComponent: "MessageList" },
        }, nb);
      }
      var burst = latestBy(function (t) { return t.renderCount > 20; });
      if (burst) {
        var rowIds = burst.eventIds.filter(function (x) { return events.some(function (e) { return e.eventId === x && e.componentName === "MessageRow"; }); });
        add({
          id: "interaction-induced-render-burst:MessageList", issueType: "interaction-induced-render-burst", category: "rendering", severity: "high",
          source: "MessageList", message: burst.renderCount + " components re-rendered after “" + burst.trigger.label + "”.",
          cause: "MessageList passes a new onSelect callback on every render, so every MessageRow re-renders.", possibleFix: "Memoize MessageRow with React.memo and stabilise callbacks with useCallback.",
          confidence: 0.81, impact: { estimatedDelayMs: Math.round(burst.renderCount * 1.2), renderCostMs: round(burst.renderCount * 1.1) },
          evidence: [
            { kind: "measurement", label: "Renders caused by one interaction", value: burst.renderCount, unit: "count", threshold: budgets.rendersPerInteraction, eventIds: rowIds.slice(0, 40), weight: 0.5 },
            { kind: "heuristic", label: "Rows re-rendered with unchanged props", value: 42, unit: "%", threshold: budgets.wastedRenderPct, eventIds: rowIds.slice(0, 10), weight: 0.3 },
          ],
          metadata: { renderCount: burst.renderCount, rootComponent: "MessageList" },
        }, burst);
      }
      var sidebar = events.filter(function (e) { return e.type === "render" && e.componentName === "Sidebar"; });
      if (sidebar.length > 5) {
        var w = sidebar.filter(function (e) { return e.wasted; });
        add({
          id: "wasted-render:Sidebar", issueType: "wasted-render", category: "rendering", severity: "medium", source: "Sidebar",
          message: "Sidebar re-rendered " + sidebar.length + " times with no prop, state or context change.",
          cause: "Its parent App re-renders every 1.2s due to the auto-refresh clock state.", possibleFix: "Move the clock state into a leaf component or wrap Sidebar in React.memo.",
          confidence: 0.95, impact: { estimatedDelayMs: round(w.length * 0.4), renderCostMs: round(w.reduce(function (a, e) { return a + e.durationMs; }, 0)) },
          evidence: [
            { kind: "measurement", label: "Wasted render share", value: round((w.length / sidebar.length) * 100), unit: "%", threshold: budgets.wastedRenderPct, eventIds: w.slice(-12).map(function (e) { return e.eventId; }), weight: 0.7 },
            { kind: "measurement", label: "Wasted renders", value: w.length, unit: "count", weight: 0.25 },
          ],
          metadata: { rootComponent: "App", affectedComponents: ["Sidebar"], timeWindowStart: sidebar[0].timestamp, timeWindowEnd: sidebar[sidebar.length - 1].timestamp },
        });
      }
      var lists = events.filter(function (e) { return e.type === "render" && e.componentName === "MessageList" && e.durationMs > budgets.componentRenderMs; });
      if (lists.length) {
        var worst = lists.reduce(function (a, b) { return b.durationMs > a.durationMs ? b : a; });
        add({
          id: "slow-component:MessageList", issueType: "slow-component", category: "rendering", severity: "medium", source: "MessageList",
          message: "MessageList render took up to " + round(worst.durationMs) + "ms (" + lists.length + " renders over budget).",
          cause: "Sorting and filtering the full message array happens during render.", possibleFix: "Memoize the derived list with useMemo keyed on messages + query.",
          confidence: 0.69, impact: { estimatedDelayMs: round(worst.durationMs - budgets.componentRenderMs), renderCostMs: round(worst.durationMs) },
          evidence: [{ kind: "measurement", label: "Slowest render", value: worst.durationMs, unit: "ms", threshold: budgets.componentRenderMs, eventIds: [worst.eventId], weight: 0.69 }],
          metadata: { affectedComponents: ["MessageList"], timeWindowStart: worst.timestamp, timeWindowEnd: worst.timestamp + worst.durationMs },
          traceId: worst.traceId,
        });
      }
      var key = latestBy(function (t) { return t.trigger.eventType === "keydown"; });
      if (key) {
        add({
          id: "keystroke-render-loop:input#query", issueType: "keystroke-render-loop", category: "interaction", severity: "high", source: "input#query",
          message: "Each keystroke in the search field triggers " + key.renderCount + " renders and a network request.",
          cause: "The query state lives in App and the fetch is not debounced.", possibleFix: "Debounce the request and keep the input state local (useDeferredValue for the list).",
          confidence: 0.63, impact: { estimatedDelayMs: Math.round(key.latencyMs * 0.5) },
          evidence: [
            { kind: "correlation", label: "Renders per keystroke", value: key.renderCount, unit: "count", threshold: 5, eventIds: key.eventIds.slice(0, 20), weight: 0.4 },
            { kind: "heuristic", label: "Request fired per keystroke", value: "yes", eventIds: [key._net.eventId], weight: 0.23 },
          ],
        }, key);
      }
      var lat = traces.map(function (t) { return t.latencyMs; }).sort(function (a, b) { return a - b; });
      var p75 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.75) - 1)] : null;
      if (p75 !== null && p75 > budgets.interactionLatencyMs) {
        add({
          id: "budget-exceeded:interactionLatencyMs", issueType: "budget-exceeded", category: "budget", severity: "low", source: "Interaction latency budget",
          message: "p75 interaction latency is " + Math.round(p75) + "ms (budget " + budgets.interactionLatencyMs + "ms).", cause: "See slow-interaction insights for the worst offenders.",
          possibleFix: "Address the slowest interactions first; adjust the budget if the target is unrealistic.", confidence: 1, impact: { estimatedDelayMs: Math.round(p75 - budgets.interactionLatencyMs) },
          evidence: [{ kind: "budget", label: "p75 interaction latency", value: p75, unit: "ms", threshold: budgets.interactionLatencyMs, eventIds: [], weight: 1 }],
        });
      }
      return out;
    }

    function summary(ins) {
      var r = events.filter(function (e) { return e.type === "render"; });
      var lts = events.filter(function (e) { return e.type === "longtask"; });
      var nets = events.filter(function (e) { return e.type === "network"; });
      var ints = events.filter(function (e) { return e.type === "interaction"; });
      var lat = ints.map(function (e) { return e.duration; }).sort(function (a, b) { return a - b; });
      var p75 = lat.length ? lat[Math.min(lat.length - 1, Math.ceil(lat.length * 0.75) - 1)] : null;
      var counts = { critical: 0, high: 0, medium: 0, low: 0 };
      ins.forEach(function (i) { counts[i.severity] += 1; });
      var wasted = r.filter(function (e) { return e.wasted; }).length;
      function res(key, label, limit, values, actual, unit) {
        var a = actual !== undefined ? actual : values.length ? Math.max.apply(null, values) : null;
        return { key: key, label: label, limit: limit, actual: a === null ? null : round(a), unit: unit, status: a === null ? "no-data" : a > limit ? "fail" : a > limit * 0.8 ? "warn" : "pass", samples: values.length, violations: values.filter(function (v) { return v > limit; }).length };
      }
      var budgetResults = [
        res("interactionLatencyMs", "Interaction latency (p75)", budgets.interactionLatencyMs, lat, p75, "ms"),
        res("longTaskMs", "Longest main-thread task", budgets.longTaskMs, lts.map(function (e) { return e.duration; }), undefined, "ms"),
        res("componentRenderMs", "Slowest component render", budgets.componentRenderMs, r.map(function (e) { return e.durationMs; }), undefined, "ms"),
        res("rendersPerInteraction", "Renders per interaction", budgets.rendersPerInteraction, traces.map(function (t) { return t.renderCount; }), undefined, "count"),
        res("networkRequestMs", "Slowest network request", budgets.networkRequestMs, nets.map(function (e) { return e.duration; }), undefined, "ms"),
        { key: "wastedRenderPct", label: "Wasted render share", limit: budgets.wastedRenderPct, actual: null, unit: "%", status: "no-data", samples: 0, violations: 0 },
      ];
      if (r.length) {
        var pct = round((wasted / r.length) * 100);
        budgetResults[5] = { key: "wastedRenderPct", label: "Wasted render share", limit: budgets.wastedRenderPct, actual: pct, unit: "%", status: pct > budgets.wastedRenderPct ? "fail" : pct > budgets.wastedRenderPct * 0.8 ? "warn" : "pass", samples: 1, violations: pct > budgets.wastedRenderPct ? 1 : 0 };
      }
      var comp = {};
      r.forEach(function (e) {
        var c = comp[e.componentName] || (comp[e.componentName] = { name: e.componentName, renders: 0, mounts: 0, wasted: 0, totalMs: 0, maxMs: 0, avgMs: 0 });
        c.renders += 1; if (e.phase === "mount") c.mounts += 1; if (e.wasted) c.wasted += 1; c.totalMs += e.durationMs; c.maxMs = Math.max(c.maxMs, e.durationMs);
      });
      var topComponents = Object.keys(comp).map(function (k) { var c = comp[k]; c.avgMs = round(c.totalMs / c.renders, 2); c.totalMs = round(c.totalMs, 2); return c; }).sort(function (a, b) { return b.totalMs - a.totalMs; }).slice(0, 10);
      var req = {};
      nets.forEach(function (e) {
        var k = e.method + " " + e.url.split("?")[0];
        var q = req[k] || (req[k] = { url: e.url.split("?")[0], method: e.method, count: 0, avgMs: 0, maxMs: 0, errors: 0, _t: 0 });
        q.count += 1; q._t += e.duration; q.maxMs = Math.max(q.maxMs, e.duration); if (e.status === 0 || e.status >= 400) q.errors += 1;
      });
      var topRequests = Object.keys(req).map(function (k) { var q = req[k]; q.avgMs = round(q._t / q.count); delete q._t; return q; }).sort(function (a, b) { return b.maxMs - a.maxMs; }).slice(0, 10);
      var fails = budgetResults.filter(function (b) { return b.status === "fail"; }).length;
      var score = Math.max(0, 100 - counts.critical * 20 - counts.high * 10 - counts.medium * 4 - counts.low - fails * 5);
      return {
        score: score, grade: score >= 90 ? "good" : score >= 50 ? "needs-improvement" : "poor",
        interactionP75Ms: p75, interactionMaxMs: lat.length ? lat[lat.length - 1] : null, interactions: ints.length,
        renders: r.length, wastedRenders: wasted, longTasks: lts.length, totalBlockingMs: round(lts.reduce(function (a, e) { return a + e.blockingDuration; }, 0)),
        requests: nets.length, failedRequests: nets.filter(function (e) { return e.status === 0 || e.status >= 400; }).length,
        insightCounts: counts, budgets: budgetResults, topComponents: topComponents, topRequests: topRequests,
      };
    }

    function publicTrace(t) {
      var out = {};
      Object.keys(t).forEach(function (k) { if (k.charAt(0) !== "_") out[k] = t[k]; });
      return out;
    }

    seed();

    return {
      hello: function (mode) {
        return {
          source: "perf-engine", version: 2, type: "HELLO", timestamp: now(),
          payload: { sessionId: sessionId, engineVersion: "0.3.0-preview", url: "http://localhost:5173/inbox?folder=primary", title: "Perf Demo — Inbox", timeOrigin: timeOrigin,
            config: { trackEvents: true, trackNetwork: true, trackRenders: true, trackLongTasks: true, trackInteractions: true, react: true, mode: mode === "injected" ? "injected" : "app" } },
        };
      },
      snapshot: function () {
        var ins = insights();
        return {
          source: "perf-engine", version: 2, type: "SNAPSHOT", timestamp: now(),
          payload: {
            sessionId: sessionId, engineVersion: "0.3.0-preview", capturedAt: capturedAt, timeOrigin: timeOrigin, paused: paused,
            insights: ins, events: events.slice(), droppedEvents: dropped, traces: traces.map(publicTrace), summary: summary(ins), budgets: Object.assign({}, budgets),
          },
        };
      },
      reset: function () {
        return { source: "perf-engine", version: 2, type: "RESET", timestamp: now(), payload: { sessionId: sessionId } };
      },
      tick: tick,
      setPaused: function (p) { paused = p; },
      clear: function () { events = []; traces = []; dropped = 0; lastTraceAt = 0; capturedAt = now(); },
      setBudgets: function (b) { Object.keys(DEFAULT_BUDGETS).forEach(function (k) { if (b && typeof b[k] === "number") budgets[k] = b[k]; }); },
    };
  }


  // ── DevTools-only layer data (HAR entries + page collector) ────────
  // Mimics chrome.devtools.network HAR entries and window.__PERF_INTEL_COLLECTOR__.read(cursor)
  // so dev/preview.html?mode=devtools exercises the real panel-side mapping code.

  function createDevtools() {
    var ORIGIN = "http://localhost:5173";
    var har = [];
    var entries = [];
    var seq = 0;
    var interactionId = 1000;
    var longest = [];
    var interactions = 0;
    var vitals = { lcp: 2860, lcpTarget: "img.hero-image", cls: 0.08, inp: null, fcp: 1240, ttfb: 420, interactions: 0 };

    function iso(t) { return new Date(timeOrigin + t).toISOString(); }

    function harEntry(t, url, opts) {
      opts = opts || {};
      var status = opts.status === undefined ? 200 : opts.status;
      var e = {
        startedDateTime: iso(t),
        time: round(opts.time || rand(30, 400)),
        request: { method: opts.method || "GET", url: (opts.cross ? "https://cdn.example.com" : ORIGIN) + url },
        response: { status: status, bodySize: status === 200 ? Math.round(rand(400, 90000)) : 0, _transferSize: opts.cache ? 0 : Math.round(rand(600, 92000)), _error: opts.error || undefined },
        _resourceType: opts.type || "fetch",
        _fromCache: opts.cache ? "memory" : undefined,
      };
      har.push(e);
      return e;
    }

    function push(item) { seq += 1; item.seq = seq; entries.push(item); if (entries.length > 1500) entries.shift(); return item; }

    function recordInp(d) {
      interactions += 1;
      longest.push(d);
      longest.sort(function (a, b) { return b - a; });
      if (longest.length > 10) longest.length = 10;
      vitals.inp = longest[Math.min(longest.length - 1, Math.floor(interactions / 50))];
      vitals.interactions = interactions;
    }

    var TARGETS = ["button#search.primary", "button.star", "input#query", "a.nav-item", "li.message-row.unread"];
    var APIS = ["/api/messages?q=perf&page=2", "/api/search?q=re", "/api/folders/inbox", "/api/sync", "/api/messages/star"];

    function interaction(t) {
      interactionId += 7;
      var heavy = Math.random() < 0.4;
      var proc = heavy ? rand(140, 320) : rand(20, 90);
      var inputDelay = rand(2, 24);
      var pres = rand(8, 40);
      var dur = Math.round(inputDelay + proc + pres);
      var target = pick(TARGETS);
      var name = target.indexOf("input") === 0 ? "keydown" : "pointerup";
      push({ kind: "event", name: name, interactionId: interactionId, startTime: t, duration: dur, inputDelay: round(inputDelay), processingMs: round(proc), presentationDelay: round(pres), target: target });
      recordInp(dur);
      if (proc > 50) {
        var ld = proc + rand(10, 30);
        push({
          kind: "loaf", startTime: t + inputDelay - 2, duration: round(ld), blockingDuration: round(Math.max(0, proc - 50)),
          scripts: [{ invoker: target.split(".")[0].toUpperCase() + ".on" + (name === "keydown" ? "keydown" : "click"), sourceURL: ORIGIN + "/assets/index-4f2a.js", sourceFunctionName: "handle" + (name === "keydown" ? "Search" : "Click"), duration: round(proc * 0.9) }],
        });
      }
      var failed = Math.random() < 0.12;
      var status = failed ? pick([500, 503, 0]) : 200;
      harEntry(t + inputDelay + proc * 0.3, pick(APIS), { time: failed ? rand(300, 1400) : rand(80, heavy ? 1300 : 450), status: status, error: status === 0 ? "net::ERR_CONNECTION_RESET" : undefined, method: Math.random() < 0.2 ? "POST" : "GET" });
    }

    function seedPage() {
      var t0 = now() - 48000;
      // Page load: document, scripts, styles, images, fonts.
      harEntry(t0 - 2, "/inbox?folder=primary", { type: "document", time: 460 });
      harEntry(t0 + 470, "/assets/index-4f2a.js", { type: "script", time: 380 });
      harEntry(t0 + 472, "/assets/index-91cc.css", { type: "stylesheet", time: 120, cache: true });
      harEntry(t0 + 880, "/img/hero.avif", { type: "image", time: 1650, cross: true });
      harEntry(t0 + 900, "/fonts/inter.woff2", { type: "font", time: 210, cross: true });
      harEntry(t0 + 1100, "/api/folders", { time: 240 });
      harEntry(t0 + 1120, "/api/messages?folder&page", { time: 780 });
      harEntry(t0 + 1300, "/api/avatar/42", { time: 90, status: 404 });
      push({ kind: "loaf", startTime: t0 + 860, duration: 184, blockingDuration: 118, scripts: [{ invoker: "Window.onload", sourceURL: ORIGIN + "/assets/index-4f2a.js", sourceFunctionName: "bootstrap", duration: 150 }] });
      push({ kind: "loaf", startTime: t0 + 2200, duration: 72, blockingDuration: 0, scripts: [] });
      var t = t0 + 3500;
      while (t < now() - 1500) {
        if (Math.random() < 0.55) interaction(t);
        if (Math.random() < 0.3) harEntry(t + 400, "/api/poll", { type: "xhr", time: rand(40, 160), cache: Math.random() < 0.3 });
        t += rand(1800, 3600);
      }
    }

    seedPage();
    var harCursor = har.length;

    return {
      origin: ORIGIN,
      getHAR: function () { return { entries: har.slice() }; },
      /** New HAR entries since the last call (for onRequestFinished). */
      tick: function () {
        if (Math.random() < 0.6) interaction(now() - 300);
        if (Math.random() < 0.3) harEntry(now() - 200, "/api/poll", { type: "xhr", time: rand(40, 160) });
        var out = har.slice(harCursor);
        harCursor = har.length;
        return out;
      },
      read: function (cursor) {
        return JSON.parse(JSON.stringify({
          v: 1, cursor: seq, entries: entries.filter(function (e) { return e.seq > cursor; }), dropped: 0, vitals: vitals,
          supported: { loaf: true, event: true, lcp: true, cls: true, paint: true, navigation: true, longtask: true },
          timeOrigin: timeOrigin, now: now(), href: ORIGIN + "/inbox?folder=primary", origin: ORIGIN, title: "Perf Demo — Inbox",
        }));
      },
    };
  }

  window.PerfFixture = { create: create, createDevtools: createDevtools };
})();
