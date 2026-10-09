/**
 * LiveRegion — screen-reader announcements for events that are otherwise only
 * visual.
 *
 * WHY THIS EXISTS
 * ---------------
 * The whole event layer was motion: a purchase bloomed, a hire slid in, a reset
 * swept. There were zero `aria-live` regions in the codebase, so none of it was
 * perceivable without sight. The state it reflects was already correct -- only the
 * channel was missing.
 *
 * `polite` rather than `assertive` on purpose. Every event here is a confirmation
 * of something the player just did, not an emergency; an assertive region would
 * interrupt whatever a screen reader was in the middle of saying. Errors keep
 * their own `role="alert"` treatment where they exist.
 *
 * The region is always mounted and visually hidden. A live region that is added to
 * the DOM at the same moment as its text is unreliable: several screen readers only
 * announce *changes* within an already-present region, so mounting on demand
 * silently drops the first message.
 */
import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../game/gameStore';
import { GENERATOR_DEFS } from '../game/generators';

/** Coalescing window, ms. Two generators arriving in the same tick is one event. */
const COALESCE_MS = 400;

export function LiveRegion() {
  const generators = useGameStore((s) => s.gameState.generators);
  const prestigeCount = useGameStore((s) => s.gameState.stats.prestigeCount);
  const pendingArrivals = useGameStore((s) => s.pendingArrivals);
  const offlineReport = useGameStore((s) => s.offlineReport);

  const [message, setMessage] = useState('');
  const lastPrestige = useRef(prestigeCount);
  const lastOwned = useRef<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(text), COALESCE_MS);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Purchases: a count change means something was bought.
  useEffect(() => {
    const owned: Record<string, number> = {};
    let parts: string[] = [];
    for (const def of GENERATOR_DEFS) {
      const n = generators[def.id]?.owned ?? 0;
      owned[def.id] = n;
      const before = lastOwned.current[def.id];
      // Ignore the first pass: on mount every generator has a count, and treating
      // that as seven simultaneous purchases would greet a returning player with
      // a wall of noise about things they bought hours ago.
      if (before === undefined) continue;
      if (n > before) parts.push(`${def.name} ×${n}`);
    }
    lastOwned.current = owned;
    if (parts.length > 0) announce(`Hired ${parts.join(', ')}`);
  }, [generators]);

  // Arrivals, including the offline batch.
  //
  // Deferred until the modal is gone. `pendingArrivals` is set during hydration,
  // before this component's first effect, so without the guard the arrival message
  // was announced first and then immediately overwritten by the offline message --
  // the coalescing timer means the last caller wins. It also duplicates what the
  // dialog is already saying out loud.
  useEffect(() => {
    if (pendingArrivals.length === 0) return;
    if (offlineReport) return;
    const names = pendingArrivals
      .map((id) => GENERATOR_DEFS.find((d) => d.id === id)?.name)
      .filter(Boolean)
      .join(', ');
    if (names) {
      announce(
        pendingArrivals.length === 1
          ? `${names} is now available`
          : `${pendingArrivals.length} new hires available: ${names}`
      );
    }
  }, [offlineReport, pendingArrivals]);

  // A reset wiping the run is a large, destructive-feeling change and deserves to
  // be announced rather than inferred from the numbers moving.
  useEffect(() => {
    if (prestigeCount === lastPrestige.current) return;
    lastPrestige.current = prestigeCount;
    announce('Run reset. Tech Debt banked.');
  }, [prestigeCount]);

  // Offline credits are reported by the modal, which is a dialog and therefore
  // announced on its own. Announcing here too would double it, so this covers
  // only the case where there is no modal to speak.
  useEffect(() => {
    if (!offlineReport || offlineReport.trivial) return;
    const hours = offlineReport.effectiveSeconds / 3600;
    const spoken = hours >= 1 ? `${hours.toFixed(1)} hours` : `${Math.round(offlineReport.effectiveSeconds / 60)} minutes`;
    announce(`Welcome back. ${spoken} of production credited.`);
  }, [offlineReport]);

  return (
    <div
      className="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // Keyed on the message so identical consecutive messages are still read:
      // assistive tech compares text content, and two identical strings would
      // otherwise register as no change.
      key={message}
    >
      {message}
    </div>
  );
}
