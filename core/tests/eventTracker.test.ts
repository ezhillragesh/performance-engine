// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startEventTracking } from "../tracker/eventTracker.js";
import { describeLabel, describeTarget, isTextEntryTarget } from "../tracker/dom.js";
import { getEvents, resetStore } from "../logger/store.js";
import { resetTraceContext } from "../trace/traceContext.js";
import { setTimeSource } from "../tracker/time.js";
import type { UIEvent } from "../types/events.js";

let clock = 0;
let stop: () => void = () => undefined;

beforeEach(() => {
  clock = 5000;
  setTimeSource(() => clock);
  resetStore();
  resetTraceContext();
  document.body.innerHTML = `
    <button id="save" class="primary large extra" aria-label="Save task">Save</button>
    <button id="plain">   Add   new
      item </button>
    <input id="name" name="username" value="secret" />
    <svg id="icon" class="icon spin"><circle /></svg>`;
  stop = startEventTracking();
});

afterEach(() => {
  stop();
  setTimeSource(undefined);
});

function uiEvents(): UIEvent[] {
  return getEvents().filter((e): e is UIEvent => e.type === "ui");
}

describe("event tracker", () => {
  it("records trigger events with target, label and trace", () => {
    document.getElementById("save")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const [event] = uiEvents();
    expect(event).toMatchObject({ eventType: "click", target: "button#save.primary.large", label: "Save task", startsTrace: true });
    expect(event!.traceId).toBeDefined();
  });

  it("does not capture scroll/focus/blur/keyup/pointerup by default", () => {
    const input = document.getElementById("name")!;
    for (const type of ["scroll", "focus", "blur", "keyup", "pointerup"]) {
      input.dispatchEvent(new Event(type, { bubbles: true }));
    }
    expect(uiEvents()).toHaveLength(0);
  });

  it("ignores modifier-only and repeated keydowns", () => {
    const input = document.getElementById("name")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(uiEvents()).toHaveLength(1);
  });

  it("never reads form values into labels", () => {
    document.getElementById("name")!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(uiEvents()[0]!.label).toBe("username");
  });

  it("handles SVG className and collapses label whitespace", () => {
    expect(describeTarget(document.getElementById("icon"))).toBe("svg#icon.icon.spin");
    expect(describeLabel(document.getElementById("plain"))).toBe("Add new item");
    expect(describeTarget(null)).toBe("unknown");
  });

  it("never labels contenteditable text (PII) or page-level containers", () => {
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    editor.innerHTML = "<p>my secret <b>password</b></p>";
    document.body.appendChild(editor);
    expect(describeLabel(editor)).toBeUndefined();
    expect(describeLabel(editor.querySelector("b"))).toBeUndefined();
    expect(describeLabel(document.body)).toBeUndefined();
    expect(describeLabel(document.documentElement)).toBeUndefined();
    const big = document.createElement("div");
    for (let i = 0; i < 500; i += 1) big.appendChild(document.createElement("span")).textContent = "a";
    expect(describeLabel(big)).toBeUndefined(); // bounded walk: a container, not a label
    editor.remove();
  });

  it("truncates long labels to 60 chars", () => {
    const el = document.createElement("div");
    el.textContent = "x".repeat(200);
    expect(describeLabel(el)!.length).toBe(60);
  });

  it("stop() is idempotent and removes listeners", () => {
    stop();
    stop();
    document.getElementById("save")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(uiEvents()).toHaveLength(0);
  });
});

describe("text-entry targets (editable flag)", () => {
  it("isTextEntryTarget: text-like inputs, textarea, contenteditable and text roles only", () => {
    document.body.innerHTML = `
      <input id="a" /><input id="b" type="search" /><input id="c" type="checkbox" /><input id="d" type="range" />
      <textarea id="e"></textarea><select id="f"><option>x</option></select>
      <div id="g" contenteditable="true"><span id="h">typed</span></div><div id="i" contenteditable="false"></div>
      <div id="j" role="searchbox"></div><div id="k" role="combobox listbox"></div>
      <button id="l" role="tab">Tab</button>`;
    const is = (id: string): boolean => isTextEntryTarget(document.getElementById(id));
    expect(["a", "b", "e", "g", "h", "j", "k"].filter(is)).toEqual(["a", "b", "e", "g", "h", "j", "k"]);
    expect(["c", "d", "f", "i", "l"].filter(is)).toEqual([]);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(document)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });

  it("records editable on keydown / input / change at capture time, not on clicks", () => {
    document.getElementById("name")!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true }));
    document.getElementById("save")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    document.getElementById("save")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const events = uiEvents();
    expect(events.map((e) => [e.eventType, e.editable])).toEqual([
      ["keydown", true],
      ["keydown", false],
      ["keydown", false],
      ["click", undefined],
    ]);
    // Only the type decides: the value is never read.
    expect(JSON.stringify(events)).not.toContain("secret");
  });
});
