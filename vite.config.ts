import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// The release version, read from package.json at build time and inlined.
//
// WHY NOT HARDCODED IN THE SIDEBAR
// --------------------------------
// It WAS hardcoded, and it shipped wrong: v0.5.1 went out with the sidebar
// reading "v0.5.0". Nothing asserted the two agreed, so the only way to notice
// was to look at the running app. That is the same drift that left
// package-lock.json claiming 0.1.0 through ten consecutive releases — two places
// holding the same fact with no mechanism keeping them together.
//
// package.json is the single source of truth; this makes it the only place the
// version is written down.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Relative asset paths so the built site works from any sub-path.
  // GitHub Pages serves this project at /IDEV-ADMIN/, but a custom domain would
  // serve from / — using a relative base means the same build works for both,
  // so switching to a domain later is a DNS change rather than a rebuild.
  base: './',
  build: {
    // Everything is bundled: `zustand` and `break_infinity.js` must NOT be
    // externalised, otherwise the emitted bundle keeps bare specifiers
    // (`import ... from "zustand"`) that no browser can resolve.
    sourcemap: true,
    // The deploy workflow has a 10 minute budget; keep well inside it.
    chunkSizeWarningLimit: 600,
  },
})
