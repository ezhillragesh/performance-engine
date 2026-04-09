export function isPerfMessage(data) {
  if (!data || typeof data !== "object") {
    return false;
  }
  return data.source === "perf-engine" && typeof data.type === "string";
}
