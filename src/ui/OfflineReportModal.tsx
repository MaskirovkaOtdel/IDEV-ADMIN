/**
 * OfflineReportModal — "welcome back" summary.
 *
 * Driven by `offlineReport` in the store, which is set by `hydrate()` on load and
 * by `catchUp()` when a hidden tab comes back. The modal is informational: the
 * credits were already applied by the time it renders.
 */
import { useRef } from 'react';
import { useGameStore } from '../game/gameStore';
import { formatDecimal, formatDuration } from '../game/formulas';
import { BASE_OFFLINE_EFFICIENCY } from '../game/offline';
import { RESOURCE_LABELS } from '../game/types';
import { requireGenDef } from '../game/generators';
import { useDialog } from './useDialog';

const RESOURCE_ORDER = ['cash', 'linesOfCode', 'coffee'] as const;

export function OfflineReportModal() {
  const report = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOfflineReport);
  const pendingArrivals = useGameStore((s) => s.pendingArrivals);

  const windowRef = useRef<HTMLDivElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  const open = Boolean(report && !report.trivial);

  useDialog({ open, onClose: dismiss, windowRef, initialFocus: dismissButtonRef });

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
