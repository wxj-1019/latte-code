import { c as _c } from 'react/compiler-runtime';
import { useEffect, useState } from 'react';
import { useTerminalFocus, useTerminalTitle } from '../../ink.js';

export const TITLE_ANIMATION_FRAMES = ['\u2802', '\u2810'];
export const TITLE_STATIC_PREFIX = '\u2733';
export const TITLE_ANIMATION_INTERVAL_MS = 960;

/**
 * Sets the terminal tab title, with an animated prefix glyph while a query
 * is running. Isolated from REPL so the 960ms animation tick re-renders only
 * this leaf component (which returns null — pure side-effect) instead of the
 * entire REPL tree.
 */
export function AnimatedTerminalTitle({
  isAnimating,
  title,
  disabled,
  noPrefix
}: {
  isAnimating: boolean;
  title: string;
  disabled?: boolean;
  noPrefix?: boolean;
}): null {
  const $ = _c(6);
  const terminalFocused = useTerminalFocus();
  const [frame, setFrame] = useState(0);
  let t1;
  let t2;
  if ($[0] !== disabled || $[1] !== isAnimating || $[2] !== noPrefix || $[3] !== terminalFocused) {
    t1 = () => {
      if (disabled || noPrefix || !isAnimating || !terminalFocused) {
        return;
      }
      const interval = setInterval(() => setFrame(f => (f + 1) % TITLE_ANIMATION_FRAMES.length), TITLE_ANIMATION_INTERVAL_MS);
      return () => clearInterval(interval);
    };
    t2 = [disabled, noPrefix, isAnimating, terminalFocused];
    $[0] = disabled;
    $[1] = isAnimating;
    $[2] = noPrefix;
    $[3] = terminalFocused;
    $[4] = t1;
    $[5] = t2;
  } else {
    t1 = $[4];
    t2 = $[5];
  }
  useEffect(t1, t2);
  const prefix = isAnimating ? TITLE_ANIMATION_FRAMES[frame] ?? TITLE_STATIC_PREFIX : TITLE_STATIC_PREFIX;
  useTerminalTitle(disabled ? null : noPrefix ? title : `${prefix} ${title}`);
  return null;
}
