import { useEffect, useRef, useState } from 'react';

import { modeSwitchStep } from './herdrView.js';

/** A press that shows no new mode in this long did not land (the agent is busy or the mode is not in its lap). */
const MODE_SWITCH_TIMEOUT_MS = 2500;

interface Switching {
  readonly target: string | null;
  readonly presses: number;
  /** After a press: the mode the screen showed then. The next press waits for it to change. */
  readonly waiting: { readonly from: string | null } | null;
}

/**
 * Walks Claude Code's permission modes to the one the user picks, by pressing Shift+Tab and reading
 * the footer after each press: the CLI offers no "set mode" key, only the cycle. `mode` is what the
 * screen shows now (`null` for the default mode); `press` sends one Shift+Tab. Gives up, telling
 * `onFail`, after a full lap or when a press changes nothing in time.
 */
export function useModePicker(mode: string | null, hasScreen: boolean, press: () => void, onFail: (target: string | null) => void) {
  const [switching, setSwitching] = useState<Switching | undefined>(undefined);
  // The callbacks are new on every render, and renders come with every screen update: keeping them out of the
  // effects' dependencies stops each render from restarting the timeout.
  const callbacks = useRef({ press, onFail, switching });
  useEffect(() => {
    callbacks.current = { press, onFail, switching };
  });
  const waitingSince = switching?.waiting === null ? undefined : switching?.presses;

  useEffect(() => {
    if (switching === undefined || !hasScreen) return;
    if (switching.waiting !== null && switching.waiting.from === mode) return;
    const step = modeSwitchStep(mode, switching.target, switching.presses);
    if (step === 'press') {
      callbacks.current.press();
      setSwitching({ target: switching.target, presses: switching.presses + 1, waiting: { from: mode } });
      return;
    }
    if (step === 'give-up') callbacks.current.onFail(switching.target);
    setSwitching(undefined);
  }, [switching, mode, hasScreen]);

  useEffect(() => {
    if (waitingSince === undefined) return undefined;
    const timer = window.setTimeout(() => {
      const current = callbacks.current.switching;
      if (current?.waiting != null) callbacks.current.onFail(current.target);
      setSwitching(undefined);
    }, MODE_SWITCH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [waitingSince]);

  return { busy: switching !== undefined, choose: (target: string | null) => setSwitching({ target, presses: 0, waiting: null }) };
}
