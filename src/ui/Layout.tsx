/**
 * Layout — sidebar / workspace split shell.
 *
 * Owns the tab state between the three play surfaces (generators, upgrades,
 * prestige). The sidebar also carries the brand and the save indicator, which is
 * where an idle game player looks for "is my progress safe".
 */
import { useState } from 'react';
import { HeaderBar } from './HeaderBar';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import { GeneratorsPanel } from './GeneratorsPanel';
import { UpgradesPanel } from './UpgradesPanel';
import { PrestigePanel } from './PrestigePanel';
import { useGameStore } from '../game/gameStore';

export type TabId = 'generators' | 'upgrades' | 'prestige';

export interface LayoutProps {
  onOpenPrestige: () => void;
  onOpenDebug?: () => void;
}

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: 'generators', label: 'Generators', hint: 'Hire the team' },
  { id: 'upgrades', label: 'Upgrades', hint: 'Buy leverage' },
  { id: 'prestige', label: 'Prestige', hint: 'Burn it for Tech Debt' },
];

export function Layout({ onOpenPrestige, onOpenDebug }: LayoutProps) {
  const [tab, setTab] = useState<TabId>('generators');
  const loadWarning = useGameStore((s) => s.loadWarning);
  const lifetimeCash = useGameStore((s) => s.gameState.resources.lifetimeCash);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⌨️
          </span>
          <div>
            <h1 className="brand-title">IDEV : ADMIN</h1>
            <p className="brand-sub">v0.2 · ship it</p>
          </div>
        </div>

        <nav className="nav" aria-label="Game sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`nav-item ${tab === entry.id ? 'active' : ''}`}
              onClick={() => setTab(entry.id)}
              aria-current={tab === entry.id}
            >
              <span className="nav-label">{entry.label}</span>
              <span className="nav-hint">{entry.hint}</span>
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

      <main className="workspace">
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
