import { logEvent } from "../logger/store";
import { now } from "./time";

let isRenderTrackingEnabled = true;

export function setRenderTrackingEnabled(enabled: boolean): void {
  isRenderTrackingEnabled = enabled;
}

export function trackRender(componentName: string): void {
  if (!isRenderTrackingEnabled) {
    return;
  }

  logEvent({
    type: "render",
    componentName,
    timestamp: now(),
  });
}
