import { beforeEach, describe, expect, it } from "vitest";
import {
  getEvents,
  getStoreStats,
  pushEvent,
  pushEvents,
  resetStore,
  setStorePaused,
} from "../logger/store.js";
import { render } from "./fixtures.js";

beforeEach(() => resetStore(100));

describe("event store", () => {
  it("keeps events ordered when late events arrive", () => {
    pushEvent(render("A", 10));
    pushEvent(render("C", 30));
    pushEvent(render("B", 20)); // e.g. network event pushed at response time with start timestamp
    expect(getEvents().map((e) => e.timestamp)).toEqual([10, 20, 30]);
  });

  it("is bounded and counts trimmed events", () => {
    for (let i = 0; i < 250; i += 1) pushEvent(render("A", i));
    const stats = getStoreStats();
    expect(stats.size).toBeLessThanOrEqual(100);
    expect(stats.trimmedEvents + stats.size).toBe(250);
    expect(getEvents()[getEvents().length - 1]!.timestamp).toBe(249);
  });

  it("drops pushes while paused and counts them", () => {
    setStorePaused(true);
    expect(pushEvent(render("A", 1))).toBe(false);
    expect(pushEvents([render("B", 2), render("C", 3)])).toBe(0);
    setStorePaused(false);
    pushEvent(render("D", 4));
    expect(getStoreStats()).toMatchObject({ size: 1, pausedDrops: 3, droppedEvents: 3 });
  });

  it("resetStore restores defaults", () => {
    setStorePaused(true);
    resetStore();
    expect(getStoreStats()).toMatchObject({ size: 0, maxSize: 2000, paused: false, droppedEvents: 0 });
  });
});
