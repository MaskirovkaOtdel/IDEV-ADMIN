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

export function Layout({ onOpenPrestige, onOpenDebug, burning }: LayoutProps) {
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
            <p className="brand-sub">v0.4.1 · ship it</p>
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
          {/* Rendered only when a handler is supplied. In a production build
              `onOpenDebug` is undefined, so the dev affordance is absent rather
              than present and inert. */}
          {onOpenDebug && (
            <button type="button" className="link-button" onClick={onOpenDebug}>
              Debug (Esc)
            </button>
          )}
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
