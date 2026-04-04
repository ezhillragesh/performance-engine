import { logEvent } from "../logger/store";
import { now } from "./time";

let isTracking = false;
let clickListener: ((event: MouseEvent) => void) | null = null;
let inputListener: ((event: Event) => void) | null = null;
let keydownListener: ((event: KeyboardEvent) => void) | null = null;
let changeListener: ((event: Event) => void) | null = null;

function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return "unknown";
  }

  const tagName = target.tagName.toLowerCase();
  const className =
    typeof target.className === "string" ? target.className.trim() : "";

  if (!className) {
    return tagName;
  }

  const classSuffix = className
    .split(/\s+/)
    .filter(Boolean)
    .join(".");

  return `${tagName}.${classSuffix}`;
}

export function startEventTracking(): () => void {
  if (isTracking || typeof document === "undefined") {
    return stopEventTracking;
  }

  clickListener = (event: MouseEvent) => {
    logEvent({
      type: "ui",
      eventType: "click",
      target: describeTarget(event.target),
      timestamp: now(),
    });
  };

  inputListener = (event: Event) => {
    logEvent({
      type: "ui",
      eventType: "input",
      target: describeTarget(event.target),
      timestamp: now(),
    });
  };

  keydownListener = (event: KeyboardEvent) => {
    logEvent({
      type: "ui",
      eventType: "keydown",
      target: describeTarget(event.target),
      key: event.key,
      timestamp: now(),
    });
  };

  changeListener = (event: Event) => {
    logEvent({
      type: "ui",
      eventType: "change",
      target: describeTarget(event.target),
      timestamp: now(),
    });
  };

  document.addEventListener("click", clickListener, true);
  document.addEventListener("input", inputListener, true);
  document.addEventListener("keydown", keydownListener, true);
  document.addEventListener("change", changeListener, true);
  isTracking = true;

  return stopEventTracking;
}

export function stopEventTracking(): void {
  if (!isTracking || typeof document === "undefined") {
    isTracking = false;
    clickListener = null;
    inputListener = null;
    keydownListener = null;
    changeListener = null;
    return;
  }

  if (clickListener) {
    document.removeEventListener("click", clickListener, true);
  }

  if (inputListener) {
    document.removeEventListener("input", inputListener, true);
  }

  if (keydownListener) {
    document.removeEventListener("keydown", keydownListener, true);
  }

  if (changeListener) {
    document.removeEventListener("change", changeListener, true);
  }

  clickListener = null;
  inputListener = null;
  keydownListener = null;
  changeListener = null;
  isTracking = false;
}
