/**
 * useGameLoop — the delta-time heartbeat for the simulation.
 *
 * Why a timer and not requestAnimationFrame:
 *   rAF is driven by the compositor, so it stops entirely when the tab is hidden.
 *   Driving the sim from rAF meant the game froze whenever you looked away, and
 *   (combined with a second catch-up path) risked double-crediting hidden time.
 *
 * Contract:
 *   • The tick callback is held in a ref, so a re-render never restarts the loop.
 *   • Ticks fire on a fixed interval and report *real* elapsed seconds; the store
 *     clamps each step to MAX_DELTA_SECONDS.
 *   • While `document.hidden`, the loop pauses completely. Time spent hidden is
 *     credited once, at offline efficiency, by the store's `catchUp` on return.
 *     This is what makes "no double-crediting" true rather than hoped for.
 */
import { useEffect, useRef } from 'react';

/** Default simulation rate. 10Hz is plenty for an idle game and keeps React cheap. */
export const DEFAULT_TICK_HZ = 10;

export function useGameLoop(onTick: (deltaSeconds: number) => void, targetHz = DEFAULT_TICK_HZ): void {
  const callbackRef = useRef(onTick);
  callbackRef.current = onTick;

  const hzRef = useRef(targetHz);
  hzRef.current = Math.max(1, Math.min(60, targetHz));

  useEffect(() => {
    const intervalMs = 1000 / hzRef.current;
    let last = Date.now();
    let disposed = false;

    const fire = () => {
      if (disposed) return;
      const now = Date.now();
      const deltaSeconds = (now - last) / 1000;
      last = now;
      // A timer can be throttled or delayed; report the true gap so the store's
      // clamp does the bounding.
      if (deltaSeconds > 0) callbackRef.current(deltaSeconds);
    };

    // A hidden tab gets no ticks at all, so hidden time is credited exactly once
    // on return rather than being paid twice (once by ticks, once by catch-up).
    let handle: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (handle !== null) return;
      last = Date.now();
      handle = setInterval(fire, intervalMs);
    };
    const stop = () => {
      if (handle === null) return;
      clearInterval(handle);
      handle = null;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, []);
}
