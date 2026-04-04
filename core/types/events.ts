export interface BaseEvent {
  timestamp: number;
}

export interface UIEvent extends BaseEvent {
  type: "ui";
  eventType: "click" | "input" | "keydown" | "change";
  target: string;
  key?: string;
}

export interface NetworkEvent extends BaseEvent {
  type: "network";
  url: string;
  duration: number;
  method?: string;
  status?: number;
  success?: boolean;
}

export interface RenderEvent extends BaseEvent {
  type: "render";
  componentName: string;
}

export type TrackedEvent = UIEvent | NetworkEvent | RenderEvent;
