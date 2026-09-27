/** Small numeric helpers shared by rules, budgets and summaries. */

/** Nearest-rank percentile (p in 0..100) of an unsorted list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function max(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let m = values[0]!;
  for (const v of values) if (v > m) m = v;
  return m;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
