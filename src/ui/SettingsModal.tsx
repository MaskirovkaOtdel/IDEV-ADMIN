/**
 * Settings — presentation and timing preferences.
 *
 * Deliberately a gear in the sidebar footer rather than a fourth nav tab: the
 * three tabs are the game loop, and a tab labelled "Settings" reads as somewhere
 * else to buy things.
 *
 * It is also where Save data lives. That was previously reachable only from a
 * ghost button at the bottom of the Prestige panel — so the only way to move a
 * save between devices was hidden in the least-visited tab. That is the reason
 * this surface exists, more than the toggles do.
 *
 * NOTHING HERE TOUCHES GAME STATE. The settings module has no import path to the
 * store, so a preference here provably cannot change a number the player earns.
 * That is the line between this and the debug panel, which calls `grantResources`.
 */
import { useRef, useState } from 'react';
import {
  AUTOSAVE_CHOICES,
  MOTION_CHOICES,
  useSettings,
  updateSettings,
  resetSettings,
} from '../game/settings';
import { useDialog } from './useDialog';
import { SaveManager } from './SaveManager';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const settings = useSettings();
  const windowRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [saveOpenRequested, setSaveOpenRequested] = useState(false);

  // Derived, not stored: while settings is closed there is no surface to open
  // Save data from, so the nested dialog cannot be up. Storing the flag and
  // clearing it in an effect would work too, but React flags setState-in-effect as
  // a cascading render, and this version has no window where the two disagree.
  const saveOpen = isOpen && saveOpenRequested;

  useDialog({
    open: isOpen,
    onClose,
    windowRef,
    // Focus the heading, not a control. It is not focusable by default, so it is
    // given tabindex="-1" below: the point is to have the dialog read out on open
    // rather than dropping the player onto a toggle they might change by pressing
    // space.
    initialFocus: headingRef,
  });

  if (!isOpen) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          ref={windowRef}
          className="modal-window modal-window-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-header">
            <h2 id="settings-title" ref={headingRef} tabIndex={-1}>
              Settings
            </h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              ×
            </button>
          </header>

          <section className="modal-body">
            <fieldset className="setting-group">
              <legend>Display</legend>

              <div className="setting-row setting-row-stack">
                <span>
                  <strong>Animations</strong>
                  <small>
                    The purchase flash, hire announcement and reset sweep. Defaults to whatever
                    your system asks for.
                  </small>
                </span>
                <div className="chip-group" role="radiogroup" aria-label="Animations">
                  {MOTION_CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      role="radio"
                      title={choice.hint}
                      aria-checked={settings.motion === choice.value}
                      className={`chip-button ${settings.motion === choice.value ? 'active' : ''}`}
                      onClick={() => updateSettings({ motion: choice.value })}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>

            <fieldset className="setting-group">
              <legend>Progress</legend>

              <div className="setting-row">
                <span>
                  <strong>Autosave interval</strong>
                  <small>
                    How often progress is written to this browser. Shorter risks less if the
                    tab is closed abruptly; longer writes less often.
                  </small>
                </span>
                <div className="chip-group" role="radiogroup" aria-label="Autosave interval">
                  {AUTOSAVE_CHOICES.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      role="radio"
                      aria-checked={settings.autosaveSeconds === seconds}
                      className={`chip-button ${settings.autosaveSeconds === seconds ? 'active' : ''}`}
                      onClick={() => updateSettings({ autosaveSeconds: seconds })}
                    >
                      {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                    </button>
                  ))}
                </div>
              </div>

              <label className="setting-row">
                <span>
                  <strong>Confirm before resetting a run</strong>
                  <small>
                    A reset wipes generators, upgrades and run resources in exchange for Tech
                    Debt. Recommended — the cheapest thing to do with a keyboard should not be
                    to destroy an afternoon of progress.
                  </small>
                </span>
                <input
                  type="checkbox"
                  className="setting-toggle"
                  checked={settings.confirmPrestige}
                  onChange={(event) =>
                    updateSettings({ confirmPrestige: event.currentTarget.checked })
                  }
                />
              </label>
            </fieldset>

            <fieldset className="setting-group">
              <legend>Your data</legend>

              <div className="setting-row">
                <span>
                  <strong>Save data</strong>
                  <small>
                    Progress lives in this browser only. Export to move it to another device or
                    keep a backup.
                  </small>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setSaveOpenRequested(true)}
                >
                  Export / import
                </button>
              </div>

              <div className="setting-row">
                <span>
                  <strong>Reset preferences</strong>
                  <small>Restores the defaults on this page. Your progress is untouched.</small>
                </span>
                <button type="button" className="btn btn-ghost" onClick={resetSettings}>
                  Reset
                </button>
              </div>
            </fieldset>
          </section>

          <footer className="modal-footer">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </footer>
        </div>
      </div>

      {/* Nested, and rendered outside the settings window so the focus trap does
          not fight itself over which dialog owns Tab. */}
      <SaveManager isOpen={saveOpen} onClose={() => setSaveOpenRequested(false)} />
    </>
  );
}
