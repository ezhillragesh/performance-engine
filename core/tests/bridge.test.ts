// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { initPerfEngine, type PerfEngineSession } from "../session.js";
import { isPanelCommandMessage } from "../bridge/devtoolsBridge.js";
import { pushEvent } from "../logger/store.js";
import { setTimeSource } from "../tracker/time.js";
import { PANEL_MESSAGE_SOURCE, PROTOCOL_VERSION, type PageMessage, type PanelCommand } from "../types/protocol.js";
import { TraceBuilder } from "./fixtures.js";

let session: PerfEngineSession;
let postSpy: MockInstance<typeof window.postMessage>;
let clock = 0;

function command(cmd: PanelCommand, payload?: unknown, source: MessageEventSource | null = window): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { source: PANEL_MESSAGE_SOURCE, version: PROTOCOL_VERSION, type: "COMMAND", command: cmd, payload },
      source,
    }),
  );
}

function sent(): PageMessage[] {
  return postSpy.mock.calls.map((call) => call[0] as PageMessage);
}

function sentTypes(): string[] {
  return sent().map((m) => m.type);
}

function slowClick(at: number): void {
  const b = new TraceBuilder();
  b.trigger("click", at);
  b.commitAt(at + 300, ["App"]);
  for (const e of b.events) pushEvent(e);
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1000;
  setTimeSource(() => clock);
  postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => undefined);
  session = initPerfEngine({ trackNetwork: false, devtools: { snapshotIntervalMs: 1000 } });
});

afterEach(() => {
  session.stop();
  postSpy.mockRestore();
  vi.useRealTimers();
  setTimeSource(undefined);
});

describe("devtools bridge", () => {
  it("sends HELLO on start and in reply to PING", () => {
    expect(sentTypes()).toEqual(["HELLO"]);
    const hello = sent()[0]!;
    expect(hello).toMatchObject({ source: "perf-engine", version: 2, type: "HELLO" });
    if (hello.type === "HELLO") {
      expect(hello.payload.sessionId).toBe(session.sessionId);
      expect(hello.payload.config).toMatchObject({ trackEvents: true, trackNetwork: false, react: false });
    }
    command("PING");
    expect(sentTypes()).toEqual(["HELLO", "HELLO"]);
  });

  it("does not stream before ATTACH", () => {
    slowClick(0);
    vi.advanceTimersByTime(5000);
    expect(sentTypes()).toEqual(["HELLO"]);
  });

  it("ATTACH replies with a snapshot and streams only on change; DETACH stops", () => {
    command("ATTACH");
    expect(sentTypes()).toEqual(["HELLO", "SNAPSHOT"]);
    vi.advanceTimersByTime(3000);
    expect(sentTypes()).toEqual(["HELLO", "SNAPSHOT"]); // unchanged -> nothing

    slowClick(0);
    vi.advanceTimersByTime(1000);
    expect(sentTypes()).toEqual(["HELLO", "SNAPSHOT", "SNAPSHOT"]);
    const last = sent()[2]!;
    if (last.type === "SNAPSHOT") {
      expect(last.payload.insights.length).toBeGreaterThan(0);
      expect(last.payload.events.length).toBe(2);
      expect(() => structuredClone(last.payload)).not.toThrow();
    }

    command("DETACH");
    slowClick(5000);
    vi.advanceTimersByTime(5000);
    expect(sentTypes()).toHaveLength(3);
  });

  it("CLEAR replies RESET then SNAPSHOT", () => {
    slowClick(0);
    command("CLEAR");
    expect(sentTypes()).toEqual(["HELLO", "RESET", "SNAPSHOT"]);
    const snap = sent()[2]!;
    if (snap.type === "SNAPSHOT") {
      expect(snap.payload.events).toHaveLength(0);
      expect(snap.payload.insights).toHaveLength(0);
    }
  });

  it("app-initiated clear() also sends RESET", () => {
    session.clear();
    expect(sentTypes()).toEqual(["HELLO", "RESET"]);
  });

  it("PAUSE/RESUME and SET_BUDGETS update the session and reply with a snapshot", () => {
    command("PAUSE");
    expect(session.isPaused()).toBe(true);
    command("RESUME");
    expect(session.isPaused()).toBe(false);
    command("SET_BUDGETS", { longTaskMs: 120, bogus: 1, networkRequestMs: "x" });
    expect(session.getBudgets()).toMatchObject({ longTaskMs: 120, networkRequestMs: 1000 });
    expect(sentTypes()).toEqual(["HELLO", "SNAPSHOT", "SNAPSHOT", "SNAPSHOT"]);
    const last = sent()[3]!;
    if (last.type === "SNAPSHOT") expect(last.payload.budgets.longTaskMs).toBe(120);
  });

  it("REQUEST_SNAPSHOT replies immediately", () => {
    command("REQUEST_SNAPSHOT");
    expect(sentTypes()).toEqual(["HELLO", "SNAPSHOT"]);
  });

  it("ignores messages from other sources or with an invalid shape", () => {
    command("PING", undefined, null);
    window.dispatchEvent(new MessageEvent("message", { data: { source: "evil", type: "COMMAND", command: "CLEAR" }, source: window }));
    window.dispatchEvent(new MessageEvent("message", { data: "PING", source: window }));
    expect(sentTypes()).toEqual(["HELLO"]);
    expect(isPanelCommandMessage({ source: PANEL_MESSAGE_SOURCE, version: 1, type: "COMMAND", command: "PING" })).toBe(false);
    expect(isPanelCommandMessage({ source: PANEL_MESSAGE_SOURCE, version: 2, type: "COMMAND", command: "NUKE" })).toBe(false);
  });

  it("stops listening after session.stop()", () => {
    session.stop();
    command("PING");
    expect(sentTypes()).toEqual(["HELLO"]);
  });
});

describe("devtools bridge: HELLO refresh", () => {
  it("re-announces when the reported config changes after start (React registered later)", async () => {
    const { startDevtoolsBridge } = await import("../bridge/devtoolsBridge.js");
    postSpy.mockClear();
    let react = false;
    const stop = startDevtoolsBridge(session, {
      getConfig: () => ({ trackEvents: true, trackNetwork: true, trackRenders: true, trackLongTasks: true, trackInteractions: true, react }),
    });
    expect(sentTypes()).toEqual(["HELLO"]);
    vi.advanceTimersByTime(0); // unchanged -> no second HELLO
    expect(sentTypes()).toEqual(["HELLO"]);
    react = true;
    command("ATTACH");
    const hellos = sent().filter((m) => m.type === "HELLO");
    expect(hellos).toHaveLength(2);
    const last = hellos[1]!;
    if (last.type === "HELLO") expect(last.payload.config.react).toBe(true);
    stop();
  });
});
