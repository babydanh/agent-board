/**
 * A cloud terminal shows tmux, which lives on the alternate screen, and tmux/Claude Code do not ask for mouse events.
 * xterm then turns every wheel tick into Up/Down arrow keys ("alternate scroll", CoreBrowserTerminal `wheel` listener),
 * and Claude Code reads Up as "recall the previous prompt". Returning false from xterm's custom wheel handler skips
 * that conversion (and mouse wheel reports); scrolling a normal buffer and opening the history view do not depend on it.
 */
export function keepWheelOutOfSession(term: { attachCustomWheelEventHandler(handler: (event: WheelEvent) => boolean): void }): void {
  term.attachCustomWheelEventHandler(() => false);
}
