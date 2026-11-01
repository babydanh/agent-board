/** Elapsed whole seconds of a wait and whether it has run longer than usual. Never negative when the clock steps back. */
export function busyView(since: number, now: number, slowAfterMs: number): { seconds: number; slow: boolean } {
  const elapsed = Math.max(0, now - since);
  return { seconds: Math.floor(elapsed / 1000), slow: elapsed >= slowAfterMs };
}
