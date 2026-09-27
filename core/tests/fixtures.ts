/**
 * Fixture builders for analyzer tests and benchmarks.
 */

import type {
  InteractionEvent,
  LongTaskEvent,
  NetworkEvent,
  RenderEvent,
  TrackedEvent,
  UIEvent,
  UIEventType,
} from "../types/events.js";

let seq = 0;
let commitSeq = 1_000_000;

export function resetFixtureIds(): void {
  seq = 0;
}

function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

const SESSION = "test-session";

export function ui(eventType: UIEventType, timestamp: number, opts: Partial<UIEvent> = {}): UIEvent {
  return {
    type: "ui",
    eventType,
    target: "button#btn",
    timestamp,
    eventId: nextId("ui"),
    sessionId: SESSION,
    ...opts,
  };
}

export function render(componentName: string, timestamp: number, opts: Partial<RenderEvent> = {}): RenderEvent {
  return {
    type: "render",
    componentName,
    durationMs: 0,
    timestamp,
    eventId: nextId("r"),
    sessionId: SESSION,
    ...opts,
  };
}

export function net(url: string, timestamp: number, duration: number, opts: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    type: "network",
    url,
    method: "GET",
    duration,
    endTime: timestamp + duration,
    status: 200,
    fromCache: false,
    initiator: "fetch",
    timestamp,
    eventId: nextId("n"),
    sessionId: SESSION,
    ...opts,
  };
}

export function longTask(timestamp: number, duration: number, opts: Partial<LongTaskEvent> = {}): LongTaskEvent {
  return {
    type: "longtask",
    api: "long-animation-frame",
    duration,
    blockingDuration: Math.max(0, duration - 50),
    timestamp,
    eventId: nextId("lt"),
    sessionId: SESSION,
    ...opts,
  };
}

export function interaction(timestamp: number, duration: number, opts: Partial<InteractionEvent> = {}): InteractionEvent {
  const inputDelay = opts.inputDelay ?? Math.round(duration * 0.1);
  const processingMs = opts.processingMs ?? Math.round(duration * 0.7);
  return {
    type: "interaction",
    name: "click",
    interactionId: 0,
    duration,
    inputDelay,
    processingMs,
    presentationDelay: opts.presentationDelay ?? Math.max(0, duration - inputDelay - processingMs),
    target: "button#btn",
    timestamp,
    eventId: nextId("it"),
    sessionId: SESSION,
    ...opts,
  };
}

/** Builds the events of one causal trace; every event carries `traceId`. */
export class TraceBuilder {
  readonly traceId: string;
  readonly events: TrackedEvent[] = [];

  constructor(traceId: string = nextId("trace-")) {
    this.traceId = traceId;
  }

  trigger(eventType: UIEventType, timestamp: number, opts: Partial<UIEvent> = {}): UIEvent {
    const startsTrace = this.events.every((e) => e.type !== "ui");
    const event = ui(eventType, timestamp, { traceId: this.traceId, ...(startsTrace ? { startsTrace: true } : {}), ...opts });
    this.events.push(event);
    return event;
  }

  /** One React commit rendering `names` (each with its own instance unless given). */
  commitAt(timestamp: number, names: string[], opts: Partial<RenderEvent> = {}): RenderEvent[] {
    commitSeq += 1;
    const commitId = opts.commitId ?? commitSeq;
    const out = names.map((name, i) =>
      render(name, timestamp, {
        traceId: this.traceId,
        commitId,
        instanceId: `${name}#${i}`,
        phase: "update",
        source: "react-hook",
        ...opts,
      }),
    );
    this.events.push(...out);
    return out;
  }

  render(name: string, timestamp: number, opts: Partial<RenderEvent> = {}): RenderEvent {
    const event = render(name, timestamp, { traceId: this.traceId, ...opts });
    this.events.push(event);
    return event;
  }

  request(url: string, timestamp: number, duration: number, opts: Partial<NetworkEvent> = {}): NetworkEvent {
    const event = net(url, timestamp, duration, { traceId: this.traceId, ...opts });
    this.events.push(event);
    return event;
  }

  longTask(timestamp: number, duration: number, opts: Partial<LongTaskEvent> = {}): LongTaskEvent {
    const event = longTask(timestamp, duration, { traceId: this.traceId, ...opts });
    this.events.push(event);
    return event;
  }

  timing(timestamp: number, duration: number, opts: Partial<InteractionEvent> = {}): InteractionEvent {
    const event = interaction(timestamp, duration, { traceId: this.traceId, ...opts });
    this.events.push(event);
    return event;
  }
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMPONENTS = ["App", "Header", "TaskList", "TaskItem", "Sidebar", "Chart", "SearchBox", "Modal", "Footer", "Avatar"];

/**
 * Realistic synthetic session of ~`count` events: interactions with commits,
 * requests whose responses cause renders, long tasks, event timing entries
 * and background timer renders. Sorted by timestamp.
 */
export function syntheticEvents(count: number, seed = 42): TrackedEvent[] {
  const random = rng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const events: TrackedEvent[] = [];
  let t = 1000;
  let commitId = 0;
  let interactionId = 0;
  while (events.length < count) {
    const b = new TraceBuilder();
    const kind = random();
    if (kind < 0.6) {
      b.trigger("pointerdown", t);
      b.trigger("click", t + 60 + random() * 40);
    } else {
      b.trigger("keydown", t);
      b.trigger("input", t + 1);
    }
    const commits = 1 + Math.floor(random() * 3);
    let ct = t + 70 + random() * 60;
    for (let c = 0; c < commits; c += 1) {
      commitId += 1;
      const size = 3 + Math.floor(random() * 12);
      const names = Array.from({ length: size }, () => pick(COMPONENTS));
      const rs = b.commitAt(ct, names, { commitId });
      for (const r of rs) {
        r.durationMs = Math.round(random() * 20 * 100) / 100;
        r.selfDurationMs = r.durationMs / 2;
        if (random() < 0.3) r.wasted = true;
        r.parentComponent = "App";
      }
      ct += 8 + random() * 30;
    }
    if (random() < 0.3) {
      const dur = 100 + random() * 1400;
      const req = b.request(pick(["/api/tasks", "/api/users", "/api/search?q"]), t + 80, dur);
      commitId += 1;
      b.commitAt((req.endTime ?? 0) + 5, ["TaskList", "TaskItem", "TaskItem", "TaskItem"], { commitId });
    }
    if (random() < 0.2) {
      b.longTask(t + 20, 50 + random() * 250, {
        scripts: [{ invoker: "BUTTON#save.onclick", sourceFunctionName: "handleSave", duration: 40 + random() * 100 }],
      });
    }
    if (random() < 0.5) {
      interactionId += 1;
      b.timing(t, 40 + random() * 400, { interactionId });
    }
    events.push(...b.events);
    // background timer renders (untraced)
    if (random() < 0.4) {
      commitId += 1;
      const bt = t + 400 + random() * 200;
      events.push(render("Clock", bt, { commitId, instanceId: "Clock#1", phase: "update", wasted: random() < 0.5 }));
    }
    t += 300 + random() * 700;
  }
  events.length = count;
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
