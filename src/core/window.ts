/** Indices to mount around `index`, clamped to the data. */
export function mountWindow(index: number, windowSize: number, count: number): number[] {
  if (count <= 0) return [];
  const center = clampIndex(index, count);
  const start = Math.max(0, center - windowSize);
  const end = Math.min(count - 1, center + windowSize);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(0, Math.round(index)), count - 1);
}

export function shouldFireEndReached(index: number, count: number, threshold: number): boolean {
  return count > 0 && index >= count - 1 - threshold;
}
