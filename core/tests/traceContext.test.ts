import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activateTrace,
  beginTrace,
  captureTraceId,
  findTraceActiveAt,
  findTraceByTriggerTime,
  getActiveTraceId,
  onUserEvent,
  resetTraceContext,
  runDetached,
  runInTrace,
  TRACE_IDLE_MS,
  TRACE_MAX_SEGMENT_MS,
} from "../trace/traceContext.js";
import { setTimeSource } from "../tracker/time.js";

let clock = 0;
/** Lets the task that activated a trace finish (releases the task pin). */
const endTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  clock = 1000;
  setTimeSource(() => clock);
  resetTraceContext();
});

afterEach(() => {
  setTimeSource(undefined);
  resetTraceContext();
});

describe("trace context", () => {
  it("pointerdown followed by click within 500ms is one trace", () => {
    const down = onUserEvent("pointerdown", clock);
    clock += 300;
    const click = onUserEvent("click", clock);
    expect(down.startsTrace).toBe(true);
    expect(click.startsTrace).toBe(false);
    expect(click.traceId).toBe(down.traceId);
  });

  it("click long after pointerdown opens a new trace", () => {
    const down = onUserEvent("pointerdown");
    clock += 600;
    const click = onUserEvent("click");
    expect(click.startsTrace).toBe(true);
    expect(click.traceId).not.toBe(down.traceId);
  });

  it.each(["click", "dblclick", "keydown", "input", "change", "submit", "pointerdown"] as const)(
    "%s starts a trace",
    (type) => {
      const result = onUserEvent(type);
      expect(result.startsTrace).toBe(true);
      expect(getActiveTraceId()).toBe(result.traceId);
    },
  );

  it.each(["focus", "blur", "keyup", "scroll", "pointerup"] as const)("%s never starts a trace", (type) => {
    const result = onUserEvent(type);
    expect(result.startsTrace).toBe(false);
    expect(result.traceId).toBeUndefined();
    expect(getActiveTraceId()).toBeUndefined();
  });

  it("keydown -> input in the same task is one gesture", () => {
    const key = onUserEvent("keydown");
    clock += 1;
    const input = onUserEvent("input");
    expect(input.traceId).toBe(key.traceId);
    expect(input.startsTrace).toBe(false);
  });

  it("separate keystrokes are separate traces", () => {
    const a = onUserEvent("keydown");
    clock += 200;
    const b = onUserEvent("keydown");
    expect(b.traceId).not.toBe(a.traceId);
  });

  it("expires after the idle period without attributed work", async () => {
    const { traceId } = onUserEvent("click");
    await endTask();
    clock += TRACE_IDLE_MS - 1;
    expect(getActiveTraceId()).toBe(traceId);
    clock += 2;
    expect(getActiveTraceId()).toBeUndefined();
  });

  it("attributed work extends the idle deadline", () => {
    const { traceId } = onUserEvent("click");
    for (let i = 0; i < 5; i += 1) {
      clock += 100;
      expect(captureTraceId()).toBe(traceId);
    }
    expect(clock - 1000).toBe(500);
  });

  it("is capped at the max segment duration even with continuous work", async () => {
    const { traceId } = onUserEvent("click");
    await endTask();
    while (clock - 1000 < TRACE_MAX_SEGMENT_MS) {
      clock += 100;
      captureTraceId();
    }
    clock += 100;
    expect(getActiveTraceId()).not.toBe(traceId);
  });

  it("runInTrace activates a trace for the callback and one idle period after", async () => {
    const id = beginTrace();
    await endTask();
    clock += 5000;
    expect(getActiveTraceId()).toBeUndefined();
    const inside = runInTrace(id, () => getActiveTraceId());
    expect(inside).toBe(id);
    await endTask();
    clock += TRACE_IDLE_MS - 10;
    expect(getActiveTraceId()).toBe(id);
    clock += 20;
    expect(getActiveTraceId()).toBeUndefined();
  });

  it("finds traces by trigger time (±50ms) and activity window", () => {
    const a = onUserEvent("pointerdown", 1000);
    clock = 1080;
    onUserEvent("click", 1080);
    clock = 3000;
    const b = onUserEvent("click", 3000);
    expect(findTraceByTriggerTime(1030)).toBe(a.traceId);
    expect(findTraceByTriggerTime(1095)).toBe(a.traceId); // matches the joined click
    expect(findTraceByTriggerTime(2990)).toBe(b.traceId);
    expect(findTraceByTriggerTime(2000)).toBeUndefined();
    expect(findTraceActiveAt(1100)).toBe(a.traceId);
    expect(findTraceActiveAt(2500)).toBeUndefined();
  });
});

describe("trace context: task boundaries", () => {
  it("a slow synchronous handler does not expire its own trace (idle clock starts after the task)", async () => {
    const { traceId } = onUserEvent("click");
    clock += 281; // e.g. busyWait(281) inside the click handler, then setState
    expect(captureTraceId()).toBe(traceId); // the render committed at the end of the task
    await endTask();
    clock += TRACE_IDLE_MS - 1;
    expect(getActiveTraceId()).toBe(traceId);
    clock += 2;
    expect(getActiveTraceId()).toBeUndefined();
  });

  it("follow-up events of the same task join the gesture even after a slow handler", async () => {
    const key = onUserEvent("keydown");
    clock += 200; // slow keydown handler; input is dispatched in the same task
    const input = onUserEvent("input");
    expect(input.traceId).toBe(key.traceId);
    expect(input.startsTrace).toBe(false);
    await endTask();
    // The join window is measured from the end of the previous handler's task.
    clock += 30;
    const change = onUserEvent("change");
    expect(change.traceId).toBe(key.traceId);
  });

  it("a response of an older trace borrows the context and then restores the live one", async () => {
    const older = beginTrace("click");
    await endTask();
    clock += 1000;
    const newer = onUserEvent("click");
    activateTrace(older); // response of the older request arrives while the newer click is live
    expect(getActiveTraceId()).toBe(older);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(getActiveTraceId()).toBe(newer.traceId);
  });

  it("a response re-activates its trace for one idle period when nothing else is live", async () => {
    const id = beginTrace("click");
    await endTask();
    clock += 5000;
    expect(getActiveTraceId()).toBeUndefined();
    activateTrace(id);
    await endTask();
    clock += TRACE_IDLE_MS - 1;
    expect(getActiveTraceId()).toBe(id);
  });

  it("runDetached hides the active trace for fn and its microtasks only", async () => {
    const { traceId } = onUserEvent("click");
    let inside: string | undefined = "unset";
    let inMicrotask: string | undefined = "unset";
    runDetached(() => {
      inside = captureTraceId();
      queueMicrotask(() => {
        inMicrotask = captureTraceId();
      });
    });
    expect(inside).toBeUndefined();
    await Promise.resolve();
    expect(inMicrotask).toBeUndefined();
    await endTask();
    expect(getActiveTraceId()).toBe(traceId);
    // A trace started while detached (new user input) is never hidden.
    let started: string | undefined;
    let seen: string | undefined;
    runDetached(() => {
      started = onUserEvent("keydown").traceId;
      seen = captureTraceId();
    });
    expect(started).toBeDefined();
    expect(started).not.toBe(traceId);
    expect(seen).toBe(started);
  });
});
