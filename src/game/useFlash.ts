/**
 * useFlash — a one-shot key that changes when a tracked value changes.
 *
 * WHY THIS EXISTS
 * ---------------
 * The event layer in App.css (purchase bloom, unlock slide-in, prestige burn)
 * is driven by real simulation state, not by a timer. That means each effect
 * needs to know *that something happened*, which a class toggle alone cannot
 * express: React will not re-apply an animation if the class never leaves.
 *
 * Returning a counter does. The caller puts it in a `key`, so the element is
 * genuinely remounted and the animation runs again — no timers, no
 * `setTimeout` cleanup, and no risk of an animation sticking on if a component
 * unmounts mid-effect.
 *
 * Deliberately not debounced: at 10Hz a purchase genuinely is ten distinct
 * events, and the CSS animation is short enough that overlapping is not
 * visible.
 */
import { useEffect, useRef, useState } from 'react';

export function useFlash(value: unknown): number {
  const [counter, setCounter] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setCounter((n) => n + 1);
    }
  }, [value]);

  return counter;
}

/**
 * True for `duration` ms after `trigger` changes.
 *
 * Used for effects that must *stop* -- a class like `just-bought` cannot linger
 * forever, and leaving it on would re-arm on any later re-render. Cleanup clears
 * the timer so a pending timeout cannot fire after unmount.
 */
export function usePulse(trigger: unknown, duration = 700): boolean {
  const [active, setActive] = useState(false);
  const previous = useRef(trigger);

  useEffect(() => {
    if (previous.current === trigger) return;
    previous.current = trigger;

    setActive(true);
    const timer = setTimeout(() => setActive(false), duration);
    return () => clearTimeout(timer);
  }, [trigger, duration]);

  return active;
}