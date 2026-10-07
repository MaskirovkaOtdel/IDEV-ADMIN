/**
 * Vitest setup — jsdom environment plus a localStorage shim per test file.
 *
 * The previous version imported a non-existent `setup` export from
 * @testing-library/react, which is why the suite never actually ran.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// jsdom in this environment starts with no storage; provide an in-memory one so
// persistence code paths are exercised instead of silently no-op'ing.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const localStorageMock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, configurable: true });
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
