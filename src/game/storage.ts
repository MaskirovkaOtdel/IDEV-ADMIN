/**
 * localStorage wrapper with corrupt-save protection.
 *
 * Contract:
 *   • `loadGameState` NEVER throws. It returns the current save, else the backup,
 *     else a fresh state, and says which one it used.
 *   • An unparseable save is quarantined to `.corrupt` for inspection and is
 *     never used as a recovery source (it is known-bad by definition); the
 *     `.backup` slot is the recovery source.
 *   • Every localStorage call is guarded: Safari private mode, disabled storage
 *     and quota errors degrade to "no persistence", never to a crash.
 */
import type { GameState } from './types';
import { deserializeState, serializeState, createInitialState } from './serialize';

export const STORAGE_NAMESPACE = 'idev-admin';
export const KEY_CURRENT = `${STORAGE_NAMESPACE}:save`;
export const KEY_BACKUP = `${STORAGE_NAMESPACE}:save.backup`;
export const KEY_CORRUPT = `${STORAGE_NAMESPACE}:save.corrupt`;
export const KEY_LAST_SAVED = `${STORAGE_NAMESPACE}:savedAt`;

export type LoadSource = 'current' | 'backup' | 'fresh';

export interface LoadResult {
  state: GameState;
  source: LoadSource;
  /** Populated when a save was rejected, for the debug panel / console. */
  error?: string;
  /** Raw text of the rejected save, already quarantined. */
  quarantined?: string;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Touch the API: some browsers only throw on first use.
    localStorage.getItem(KEY_LAST_SAVED);
    return localStorage;
  } catch {
    return null;
  }
}

function readKey(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): boolean {
  try {
    storage()?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Safely load the game, falling back through current -> backup -> fresh. */
export function loadGameState(now: number = Date.now()): LoadResult {
  const currentRaw = readKey(KEY_CURRENT);

  if (currentRaw) {
    try {
      const state = deserializeState(currentRaw, now);
      // Recover from a save that was written but never validated end-to-end.
      if (!state.resources.cash || !state.resources.linesOfCode) {
        throw new Error('Save is missing core resources after deserialization');
      }
      // A save loaded cleanly, so any earlier quarantine has served its purpose.
      removeKey(KEY_CORRUPT);
      return { state, source: 'current' };
    } catch (err) {
      const message = (err as Error).message;
      console.warn('[storage] current save rejected, quarantining:', message);
      writeKey(KEY_CORRUPT, currentRaw);
      return recoverFromBackup(now, message, currentRaw);
    }
  }

  // No current save at all — a backup may still be worth restoring.
  return recoverFromBackup(now, undefined, undefined);
}

function recoverFromBackup(now: number, error: string | undefined, quarantined: string | undefined): LoadResult {
  const backupRaw = readKey(KEY_BACKUP);
  if (backupRaw) {
    try {
      const state = deserializeState(backupRaw, now);
      writeKey(KEY_CURRENT, backupRaw);
      console.warn('[storage] restored game from backup save');
      return { state, source: 'backup', error, quarantined };
    } catch (err) {
      console.error('[storage] backup save is corrupt too:', (err as Error).message);
      writeKey(KEY_CORRUPT, backupRaw);
    }
  }

  return { state: createInitialState(now), source: 'fresh', error, quarantined };
}

/** Persist the game. Returns false when persistence is unavailable. */
export function saveGameState(state: GameState, now: number = Date.now()): boolean {
  let serialized: string;
  try {
    serialized = serializeState(state, now);
  } catch (err) {
    console.error('[storage] failed to serialize state:', err);
    return false;
  }

  const existing = readKey(KEY_CURRENT);
  if (existing) {
    // Only move the previous save into the backup slot when it actually parses,
    // so a corrupt string can never become the recovery source.
    try {
      deserializeState(existing, now);
      writeKey(KEY_BACKUP, existing);
    } catch {
      writeKey(KEY_CORRUPT, existing);
    }
  }

  if (!writeKey(KEY_CURRENT, serialized)) {
    console.error('[storage] unable to write save (storage disabled or quota exceeded)');
    return false;
  }

  writeKey(KEY_LAST_SAVED, String(now));
  // The .corrupt slot is deliberately NOT cleared here: it is forensic data, and
  // wiping it on the next autosave would destroy the evidence within 15 seconds
  // of the failure. It is cleared once a save loads cleanly (see loadGameState).
  return true;
}

/** Epoch ms of the last successful save, or null. */
export function getLastSavedAt(): number | null {
  const raw = readKey(KEY_LAST_SAVED);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Raw save string, for the export button. */
export function readSaveString(): string | null {
  return readKey(KEY_CURRENT);
}

/** Import a save string (used by the Debug panel). Throws on invalid input. */
export function writeSaveString(json: string, now: number = Date.now()): GameState {
  const state = deserializeState(json, now);
  saveGameState(state, now);
  return state;
}

/** Wipe every save slot (Debug panel "hard reset"). */
export function clearSaveData(): void {
  removeKey(KEY_CURRENT);
  removeKey(KEY_BACKUP);
  removeKey(KEY_CORRUPT);
  removeKey(KEY_LAST_SAVED);
}
