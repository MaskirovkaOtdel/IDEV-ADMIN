/**
 * OfflineReportModal — "welcome back" summary.
 *
 * Driven by `offlineReport` in the store, which is set by `hydrate()` on load and
 * by `catchUp()` when a hidden tab comes back. The modal is informational: the
 * credits were already applied by the time it renders.
 */
import { useEffect, useRef } from 'react';
import { useGameStore } from '../game/gameStore';
import { formatDecimal, formatDuration } from '../game/formulas';
import { BASE_OFFLINE_EFFICIENCY } from '../game/offline';
import { RESOURCE_LABELS } from '../game/types';
import { requireGenDef } from '../game/generators';

const RESOURCE_ORDER = ['cash', 'linesOfCode', 'coffee'] as const;

/** Elements the focus trap will cycle through. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function OfflineReportModal() {
  const report = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOfflineReport);
  const pendingArrivals = useGameStore((s) => s.pendingArrivals);

  // Dialog behaviour.
  //
  // This modal had no `role`, no `aria-modal`, no Escape handling and no focus
  // management, while ConfirmResetModal had a role. It is the modal every
  // returning player sees, so it is the one where getting this wrong matters
  // most: a screen reader user was told nothing had opened, Tab walked out of the
  // dialog into the page behind it, and Escape did nothing.
  const windowRef = useRef<HTMLDivElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);

  const open = Boolean(report && !report.trivial);

  // Move focus in on open, and hand it back on close.
  useEffect(() => {
    if (!open) return;
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    dismissButtonRef.current?.focus();
    return () => restoreFocusTo.current?.focus?.();
  }, [open]);

  // Escape closes. Without it a keyboard user had no non-pointer way out.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;

      // Trap focus. Two focusable elements here, but written as a general loop so
      // adding a control later does not silently reopen the escape hatch.
      const root = windowRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute('disabled')
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dismiss, open]);

  if (!report || report.trivial) return null;

  const arrivalsText =
    pendingArrivals.length === 0
      ? null
      : pendingArrivals.length === 1
        ? '1 new hire available'
        : `${pendingArrivals.length} new hires available`;

  return (
    <div className="modal-backdrop" onClick={dismiss}>
      <div
        ref={windowRef}
        className="modal-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offline-report-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2 id="offline-report-title">Welcome back</h2>
          {/* Matches ConfirmResetModal, which already had one. It also gives the
              dialog a second focusable control, so the focus trap wraps between
              two elements rather than being trivially satisfied by one. */}
          <button type="button" className="modal-close" onClick={dismiss} aria-label="Close">
            ×
          </button>
        </header>

        <section className="modal-body">
          <p className="modal-lede">
            You were away for <strong>{formatDuration(report.elapsedSeconds)}</strong>.
            {report.elapsedSeconds > report.cappedSeconds && (
              <> Offline production is capped at 8 hours.</>
            )}
          </p>
          <p>
            Credited at {Math.round(report.efficiency * 100)}% efficiency —{' '}
            <strong>{formatDuration(report.effectiveSeconds)}</strong> of production.
            {report.efficiency > BASE_OFFLINE_EFFICIENCY && (
              <> (raised from {Math.round(BASE_OFFLINE_EFFICIENCY * 100)}% by permanent upgrades.)</>
            )}
          </p>

          <ul className="offline-gains">
            {RESOURCE_ORDER.map((id) => {
              const gained = report.gained?.[id];
              if (!gained) return null;
              return (
                <li key={id}>
                  <span>{RESOURCE_LABELS[id]}</span>
                  <span>+{formatDecimal(gained)}</span>
                </li>
              );
            })}
          </ul>

          {/* Announce arrivals here rather than letting the cards animate
              silently behind a modal. Without this the player dismisses the
              summary and either misses the arrivals entirely or wonders what the
              brief movement on the cards was. Naming them makes the dismissal
              meaningful: you are told what turned up, then you go look at it. */}
          {arrivalsText && (
            <p className="offline-arrivals">
              {arrivalsText}
              : <strong>{pendingArrivals.map((id) => requireGenDef(id).name).join(', ')}</strong>
            </p>
          )}
        </section>

        <footer className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            ref={dismissButtonRef}
            onClick={dismiss}
          >
            Back to work
          </button>
        </footer>
      </div>
    </div>
  );
}
