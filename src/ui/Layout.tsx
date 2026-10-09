/**
 * Layout — sidebar / workspace split shell.
 *
 * Owns the tab state between the three play surfaces (generators, upgrades,
 * prestige). The sidebar also carries the brand and the save indicator, which is
 * where an idle game player looks for "is my progress safe".
 */
import { useMemo, useState } from 'react';
import { HeaderBar } from './HeaderBar';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import { GeneratorsPanel } from './GeneratorsPanel';
import { UpgradesPanel } from './UpgradesPanel';
import { PrestigePanel } from './PrestigePanel';
import { useGameStore } from '../game/gameStore';
import { techDebtForLifetimeCash } from '../game/prestige';
import { formatDecimal } from '../game/formulas';
import { dec, ZERO } from '../game/decimal';

export type TabId = 'generators' | 'upgrades' | 'prestige';

export interface LayoutProps {
  onOpenPrestige: () => void;
  onOpenDebug?: () => void;
  /** Opens the settings dialog. Always supplied in both dev and production. */
  onOpenSettings: () => void;
  /** True for a short window after a prestige reset, to play the burn sweep. */
  burning?: boolean;
}

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'generators', label: 'Generators', hint: 'Hire the team' },
  { id: 'upgrades', label: 'Upgrades', hint: 'Buy leverage' },
  { id: 'prestige', label: 'Prestige', hint: 'Burn it for Tech Debt' },
];

/** Cheapest permanent upgrade. Below this a reset banks nothing spendable. */
const RESET_WORTH = dec(25);

export function Layout({ onOpenPrestige, onOpenDebug, onOpenSettings, burning }: LayoutProps) {
  const [tab, setTab] = useState<TabId>('generators');
  const loadWarning = useGameStore((s) => s.loadWarning);
  const lifetimeCash = useGameStore((s) => s.gameState.resources.lifetimeCash);

  // What a reset is currently worth. The Prestige tab showed this, but only if you
  // navigated to it -- and "Burn it for Tech Debt" is not a reason to click when
  // the header reads TECH DEBT 0. In a reviewed save, 402 debt sat unclaimed
  // behind that zero for nine hours of play.
  //
  // Selected as primitives and derived outside the selector: `techDebtForLifetimeCash`
  // allocates a new Decimal per call, and a zustand selector returning a fresh
  // object re-renders forever under v5.
  const bankedLifetimeCash = useGameStore((s) => s.gameState.prestige.baselineLifetimeCash);
  const pendingTechDebt = useMemo(() => {
    const earned = lifetimeCash.minus(bankedLifetimeCash ?? ZERO);
    return techDebtForLifetimeCash(earned.lessThan(ZERO) ? ZERO : earned);
  }, [lifetimeCash, bankedLifetimeCash]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⌨️
          </span>
          <div>
            <h1 className="brand-title">IDEV : ADMIN</h1>
            <p className="brand-sub">v0.5.0 · ship it</p>
          </div>
        </div>

        <nav className="nav" aria-label="Game sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`nav-item ${tab === entry.id ? 'active' : ''} ${
                entry.id === 'prestige' && pendingTechDebt.gt(RESET_WORTH) ? 'nav-item-actionable' : ''
              }`}
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id}
            >
              <span className="nav-label">
                {entry.label}
                {entry.id === 'prestige' && pendingTechDebt.gt(RESET_WORTH) && (
                  <span className="nav-dot" aria-hidden="true" />
                )}
              </span>
              <span className="nav-hint">
                {entry.id === 'prestige' && pendingTechDebt.gt(RESET_WORTH)
                  ? `${formatDecimal(pendingTechDebt)} debt ready`
                  : entry.hint}
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <SaveStatusIndicator />
          <div className="sidebar-footer-actions">
            {/* Settings rather than a fourth nav tab: the three tabs are the game
                loop, and a tab called "Settings" reads as somewhere else to buy
                things. This is also the only route to save export/import, which
                used to live behind a ghost button at the bottom of the Prestige
                panel -- the sole way to move a save between devices was hidden in
                the least-visited tab. */}
            <button
              type="button"
              className="icon-button"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {/* Rendered only when a handler is supplied. In a production build
                `onOpenDebug` is undefined, so the dev affordance is absent rather
                than present and inert. */}
            {onOpenDebug && (
              <button type="button" className="link-button" onClick={onOpenDebug}>
                Debug (Esc)
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className={`workspace ${burning ? 'is-burning' : ''}`}>
        <HeaderBar lifetimeCash={lifetimeCash} />

        {loadWarning && (
          <div className="banner banner-warning" role="status">
            A previous save could not be read and was quarantined: {loadWarning}
          </div>
        )}

        <div className="workspace-content">
          {tab === 'generators' && <GeneratorsPanel />}
          {tab === 'upgrades' && <UpgradesPanel />}
          {tab === 'prestige' && (
            <PrestigePanel onOpenResetModal={onOpenPrestige} />
          )}
        </div>
      </main>
    </div>
  );
}
