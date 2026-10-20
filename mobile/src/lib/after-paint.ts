/**
 * Runs `work` after the next frame is drawn, so a busy spinner set just before a
 * synchronous write (SQLite, file copy) is visible while the write runs.
 */
export function afterPaint(work: () => void): void {
  requestAnimationFrame(() => setTimeout(work, 0));
}
