import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

// Mirrors the `define` in vite.config.ts so `__APP_VERSION__` resolves under test.
//
// Without this the sidebar version constant is undefined in every test, and the
// test that checks it matches package.json cannot run at all — the assertion most
// likely to be silently dropped being the one that cannot execute.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.ts',
  },
})