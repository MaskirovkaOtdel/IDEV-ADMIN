/**
 * Player settings — presentation and timing only.
 *
 * WHY THIS IS NOT IN THE SAVE BLOB
 * --------------------------------
 * These are device preferences, not progress. Putting them in the save would mean
 * importing a save silently changed somebody's accessibility settings, and would
 * force a `CURRENT_SAVE_VERSION` bump — making a cosmetic feature a minor release.
 * They live under their own key instead.
 *
 * THE LINE
 * --------
 * Settings READ state. Debug tools WRITE state. That is the entire distinction
 * between this module and the debug panel, and it is why the debug panel is
 * dangerous: it calls `grantResources`, which mints money.
 *
 * Nothing here imports the store. There is no import path from this file to
 * `buyGenerator`, `grantResources` or `hardReset`, so a setting provably cannot
 * change a number the player earns. That is enforced structurally rather than by
 * review, because "don't add cheats to the settings menu" is exactly the kind of
 * rule that erodes one option at a time.
 */
import { useSyncExternalStore } from 'react';

export const KEY_SETTINGS = 'idev-admin:settings';

export interface Settings {
  /**
   * Whether the event effects play.
   *
   * Tri-state rather than a boolean, because the honest default is "whatever the
   * operating system says". A boolean defaulting to true would silently override
   * `prefers-reduced-motion` for every player, which is the opposite of what that
   * preference exists for. `?motion=force` still overrides everything, so a link
   * can be shared without touching anybody's saved preference.
   */
  motion: MotionPreference;
  /** Seconds between autosaves. Shorter is safer, longer is quieter on storage. */
  autosaveSeconds: number;
  /** Ask before burning a run for Tech Debt. */
  confirmPrestige: boolean;
}

export type MotionPreference = 'system' | 'always' | 'never';

export const MOTION_CHOICES: { value: MotionPreference; label: string; hint: string }[] = [
  { value: 'system', label: 'Match system', hint: 'Follows your OS accessibility setting.' },
  { value: 'always', label: 'Always on', hint: 'Plays even if your system asks for less motion.' },
  { value: 'never', label: 'Off', hint: 'No motion effects at all.' },
];

export const DEFAULT_SETTINGS: Settings = {
  motion: 'system',
  autosaveSeconds: 15,
  confirmPrestige: true,
};

/** Autosave intervals offered in the UI, in seconds. */
export const AUTOSAVE_CHOICES = [5, 15, 30, 60] as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Coerce arbitrary parsed JSON into valid settings.
 *
 * localStorage is user-writable and survives across versions, so every field is
 * treated as hostile. A corrupt value falls back to the default rather than
 * propagating NaN into the autosave interval or leaving the game unplayable.
 */
export function parseSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  const motion = record.motion;
  return {
    motion:
      motion === 'always' || motion === 'never' || motion === 'system'
        ? motion
        : DEFAULT_SETTINGS.motion,
    autosaveSeconds: clampInt(
      record.autosaveSeconds,
      1,
      600,
      DEFAULT_SETTINGS.autosaveSeconds
    ),
    confirmPrestige: clampBool(record.confirmPrestige, DEFAULT_SETTINGS.confirmPrestige),
  };
}

function read(): Settings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(JSON.parse(localStorage.getItem(KEY_SETTINGS) ?? 'null'));
  } catch {
    // Corrupt JSON. Falling back is strictly better than throwing on boot: the
    // save itself is a separate key and is unaffected.
    return { ...DEFAULT_SETTINGS };
  }
}

let current: Settings = read();
const listeners = new Set<() => void>();

function write(next: Settings) {
  current = next;
  try {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
  } catch {
    // Storage full or disabled. The setting still applies for this session, which
    // is better than refusing to change it at all.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing a preference should not require a reload to take effect.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY_SETTINGS) return;
    current = read();
    for (const l of listeners) l();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): Settings {
  return current;
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function updateSettings(patch: Partial<Settings>): void {
  write({ ...current, ...patch });
}

export function resetSettings(): void {
  write({ ...DEFAULT_SETTINGS });
}

/** Read without subscribing. For event handlers and non-React call sites. */
export function settingsSnapshot(): Settings {
  return current;
}

/**
 * Whether the event effects should play right now.
 *
 * The URL wins over everything, so `?motion=force` works as a shareable link
 * without touching the reader's saved preference. Otherwise `system` defers to
 * `prefers-reduced-motion`, which is the default.
 *
 * `prefersSystemReduce` is injected rather than read here so this stays a pure
 * function of its inputs and is testable without a browser media-query stub.
 */
export function motionAllowed(
  search: string = typeof location === 'undefined' ? '' : location.search,
  prefersSystemReduce: boolean = systemPrefersReducedMotion(),
  preference: MotionPreference = current.motion
): boolean {
  const param = new URLSearchParams(search).get('motion');
  if (param === 'force' || param === 'on') return true;
  if (param === 'off') return false;
  if (preference === 'always') return true;
  if (preference === 'never') return false;
  return !prefersSystemReduce;
}

function systemPrefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false;
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Reset hooks between tests, so module state cannot leak across cases. */
export function __resetSettingsForTest(): void {
  current = read();
}
