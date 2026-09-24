import {
  buildAnalysisContext,
  type AnalysisContext,
  type InteractionTrace,
  type RenderChain,
} from "../analyzer/context";
import type { TrackedEvent, UIEvent, RenderEvent, NetworkEvent } from "../types/events";
import { generateEventId, generateTraceId, generateSessionId, setCurrentSessionId } from "../tracker/id";

// Simple test runner
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Test utilities
function createUIEvent(
  type: UIEvent["eventType"],
  timestamp: number,
  target = "button",
  traceId?: string
): UIEvent {
  return {
    type: "ui",
    eventType: type,
    target,
    timestamp,
    eventId: generateEventId(),
    traceId,
    sessionId: generateSessionId(),
  };
}

function createRenderEvent(
  componentName: string,
  timestamp: number,
  durationMs = 0,
  traceId?: string
): RenderEvent {
  return {
    type: "render",
    componentName,
    durationMs,
    timestamp,
    eventId: generateEventId(),
    traceId,
    sessionId: generateSessionId(),
  };
}

function createNetworkEvent(
  url: string,
  timestamp: number,
  duration: number,
  traceId?: string
): NetworkEvent {
  return {
    type: "network",
    url,
    method: "GET",
    duration,
    status: 200,
    fromCache: false,
    timestamp,
    eventId: generateEventId(),
    traceId,
    sessionId: generateSessionId(),
  };
}

// Test: Events are ordered correctly
function testEventsOrdered(): void {
  const events: TrackedEvent[] = [
    createUIEvent("click", 100),
    createRenderEvent("App", 50),
    createRenderEvent("Button", 150),
  ];

  const context = buildAnalysisContext(events);

  // Events should be sorted by timestamp
  assert(context.events[0].timestamp === 50, "First event should be at 50ms");
  assert(context.events[1].timestamp === 100, "Second event should be at 100ms");
  assert(context.events[2].timestamp === 150, "Third event should be at 150ms");

  console.log("✓ testEventsOrdered passed");
}

// Test: A click and its subsequent renders belong to one trace
function testClickAndRendersInSameTrace(): void {
  const clickTime = 100;
  const events: TrackedEvent[] = [
    createUIEvent("click", clickTime, "button"),
    createRenderEvent("App", 110),
    createRenderEvent("Button", 120),
    createRenderEvent("TaskList", 130),
  ];

  const context = buildAnalysisContext(events);

  assert(context.traces.length === 1, "Should have one trace");
  const trace = context.traces[0];
  assert(trace.trigger.eventType === "click", "Trace should be triggered by click");
  assert(trace.renders.length === 3, "Trace should have 3 renders");
  assert(trace.renderChains.length === 1, "Should have one render chain");
  assert(trace.traceId === trace.trigger.traceId, "Trace ID should match trigger event");

  console.log("✓ testClickAndRendersInSameTrace passed");
}

// Test: A network request can belong to the same interaction trace
function testNetworkRequestInSameTrace(): void {
  const clickTime = 100;
  const events: TrackedEvent[] = [
    createUIEvent("click", clickTime, "button"),
    createRenderEvent("App", 110),
    createNetworkEvent("/api/task", 115, 200),
    createRenderEvent("TaskList", 320),
  ];

  const context = buildAnalysisContext(events);

  assert(context.traces.length === 1, "Should have one trace");
  const trace = context.traces[0];
  assert(trace.networkRequests.length === 1, "Trace should have 1 network request");
  assert(trace.networkRequests[0].url === "/api/task", "Network request URL should match");

  console.log("✓ testNetworkRequestInSameTrace passed");
}

// Test: Separate interactions produce separate traces
function testSeparateInteractionsSeparateTraces(): void {
  const events: TrackedEvent[] = [
    createUIEvent("click", 100, "button1"),
    createRenderEvent("App", 110),
    createRenderEvent("Button", 120),
    createUIEvent("click", 500, "button2"),
    createRenderEvent("App", 510),
    createRenderEvent("Modal", 520),
  ];

  const context = buildAnalysisContext(events);

  assert(context.traces.length === 2, "Should have two traces");

  const trace1 = context.traces[0];
  assert(trace1.trigger.target === "button1", "First trace should be button1");
  assert(trace1.renders.length === 2, "First trace should have 2 renders");

  const trace2 = context.traces[1];
  assert(trace2.trigger.target === "button2", "Second trace should be button2");
  assert(trace2.renders.length === 2, "Second trace should have 2 renders");

  assert(trace1.traceId !== trace2.traceId, "Traces should have different IDs");

  console.log("✓ testSeparateInteractionsSeparateTraces passed");
}

// Test: Unrelated events do not incorrectly get attached to an interaction
function testUnrelatedEventsNotAttached(): void {
  const events: TrackedEvent[] = [
    // Background render before any interaction
    createRenderEvent("Background", 10),
    createUIEvent("click", 100, "button"),
    createRenderEvent("App", 110),
    // Another background render long after interaction window
    createRenderEvent("Background2", 5000),
  ];

  const context = buildAnalysisContext(events);

  assert(context.traces.length === 1, "Should have one trace");
  const trace = context.traces[0];
  // The trace should only include the click and its related render
  assert(trace.renders.length === 1, "Trace should only have 1 render (the related one)");
  assert(trace.renders[0].componentName === "App", "Should be the App render");

  console.log("✓ testUnrelatedEventsNotAttached passed");
}

// Test: Existing analyzer behavior does not regress (interactions still work)
function testInteractionWindowStillWorks(): void {
  const events: TrackedEvent[] = [
    createUIEvent("click", 100, "button"),
    createRenderEvent("App", 110),
    createRenderEvent("Button", 120),
    createRenderEvent("TaskList", 130),
    createRenderEvent("TaskItem", 140),
    createRenderEvent("TaskItem", 150),
    createRenderEvent("TaskItem", 160),
  ];

  const context = buildAnalysisContext(events);

  // Both traces and interactions should exist
  assert(context.traces.length === 1, "Should have one trace");
  assert(context.interactions.length === 1, "Should have one interaction window");

  // Interaction should have the render events
  const interaction = context.interactions[0];
  assert(interaction.renderEvents.length === 6, "Interaction should have 6 render events");

  console.log("✓ testInteractionWindowStillWorks passed");
}

// Test: Trace contains all event types
function testTraceContainsAllEventTypes(): void {
  const events: TrackedEvent[] = [
    createUIEvent("click", 100, "button"),
    createRenderEvent("App", 110),
    createNetworkEvent("/api/data", 115, 200),
    createRenderEvent("List", 320),
    // keydown at 500ms - well outside click's interaction window (100 + 300 = 400ms)
    createUIEvent("keydown", 500, "input"),
    createRenderEvent("Input", 510),
  ];

  const context = buildAnalysisContext(events);

  // Should have 2 traces (click + keydown)
  assert(context.traces.length === 2, "Should have two traces");

  const clickTrace = context.traces[0];
  assert(clickTrace.uiEvents.length === 1, "Click trace should have 1 UI event");
  assert(clickTrace.renders.length === 2, "Click trace should have 2 renders");
  assert(clickTrace.networkRequests.length === 1, "Click trace should have 1 network request");

  const keydownTrace = context.traces[1];
  assert(keydownTrace.uiEvents.length === 1, "Keydown trace should have 1 UI event");
  assert(keydownTrace.renders.length === 1, "Keydown trace should have 1 render");
  assert(keydownTrace.networkRequests.length === 0, "Keydown trace should have 0 network requests");

  console.log("✓ testTraceContainsAllEventTypes passed");
}

// Test: Chained interactions (rapid clicks) create proper traces
function testChainedInteractions(): void {
  const events: TrackedEvent[] = [
    createUIEvent("click", 100, "button1"),
    createRenderEvent("App", 110),
    createUIEvent("click", 150, "button2"), // Within CHAINED_INTERACTION_GAP_MS (80ms)
    createRenderEvent("Modal", 160),
  ];

  const context = buildAnalysisContext(events);

  // Should create separate traces for each interaction
  assert(context.traces.length === 2, "Should have two traces even for chained interactions");

  const trace1 = context.traces[0];
  assert(trace1.trigger.target === "button1", "First trace should be button1");

  const trace2 = context.traces[1];
  assert(trace2.trigger.target === "button2", "Second trace should be button2");

  console.log("✓ testChainedInteractions passed");
}

// Run all tests
function runTests(): void {
  console.log("Starting tests...");
  // Reset session ID for consistent tests
  setCurrentSessionId("test-session");

  try {
    console.log("Running testEventsOrdered...");
    testEventsOrdered();
    console.log("Running testClickAndRendersInSameTrace...");
    testClickAndRendersInSameTrace();
    console.log("Running testNetworkRequestInSameTrace...");
    testNetworkRequestInSameTrace();
    console.log("Running testSeparateInteractionsSeparateTraces...");
    testSeparateInteractionsSeparateTraces();
    console.log("Running testUnrelatedEventsNotAttached...");
    testUnrelatedEventsNotAttached();
    console.log("Running testInteractionWindowStillWorks...");
    testInteractionWindowStillWorks();
    console.log("Running testTraceContainsAllEventTypes...");
    testTraceContainsAllEventTypes();
    console.log("Running testChainedInteractions...");
    testChainedInteractions();

    console.log("\n✅ All tests passed!");
  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }
}

runTests();