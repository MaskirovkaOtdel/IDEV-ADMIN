# IDEV : ADMIN

An idle game about shipping software. Hire developers, buy upgrades, then reset
the whole thing for permanent Tech Debt multipliers that carry across runs.

Browser-based, no backend, no accounts. Progress lives in `localStorage`.

## Playing

```
npm install
npm run dev
```

Open http://localhost:5173. Press `Escape` to toggle the debug panel.

## How it works

**Three resources.** Cash buys generators. Lines of Code and Coffee are produced
alongside it and both bill out as Cash every second, so stockpiling either is a
way to bank money.

**Seven generators**, unlocking at 400, 2.5K, 15K, 60K, 250K and 1M lifetime
cash. Costs grow geometrically per unit owned, so buy-behind stays relevant.

**Twelve upgrades** paid in whichever resource suits them, gated on generator
counts or lifetime totals. Effects are multiplicative factors and stack.

**Prestige** wipes the run for Tech Debt, which buys permanent multipliers.
Payout is based on cash earned *since your last reset*, not lifetime cash, so a
reset cannot be repeated for free Tech Debt.

**Offline progress** credits 50% of elapsed time, capped at 8 hours, applied by
walking the same engine the live loop uses.

### Pacing

The tuning target is **45–60 minutes to the first permanent Tech Debt tier**
(275K unbanked lifetime cash) for active play. This is measured, not asserted:

```
npm run simulate
```

```
Active play — buys every 5s — the tuning target

  3m 43s      Upgrade: Code Master
  4m 14s      Senior Dev unlocked              lifetime cash 400
  8m 46s      Code Review unlocked             lifetime cash 2.50K
  16m 52s     Linter unlocked                  lifetime cash 15K
  33m 18s     Test Suite unlocked              lifetime cash 60K
  46m 39s     FIRST PERMANENT TIER affordable  Tech Debt 25
  48m 16s     K8s Cluster unlocked             lifetime cash 1M

  First permanent tier: 46m 39s  [ON TARGET]
  Target window: 45m 0s – 1h 0m
```

Idle play (checking every 30s) reaches the same tier at 48m 54s — the economy
self-accelerates enough that play style barely matters, which is the intent.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and production build |
| `npm run preview` | Serve the production build |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc -b`, no emit |
| `npm run lint` | oxlint |
| `npm run simulate` | Balance simulation report |
| `npm run check:workflows` | Parse and shape-check the Actions workflow YAML |
| `npm run check:workflows` | Parse and shape-check the Actions workflow YAML |
| `npm run verify` | lint + typecheck + workflows + test + build, the gate for PRs |

Requires Node 22 or newer. `.nvmrc` is the single source of truth for the
version CI runs; the workflows pin `node-version` literally and
`npm run check:workflows` fails if they drift from `.nvmrc`.

## Deployment

Every green push to `main` deploys to GitHub Pages automatically. One workflow
(`.github/workflows/verify-deploy.yml`) does both halves, so a commit gets a
single check that means "this is good and it is live":

- **Verify** — lint, typecheck, workflow YAML check, test, build, plus a balance
  simulation, on every push and PR. Running the simulation means an economy
  regression shows up in the log instead of waiting to be noticed.
- **Deploy** — `main` only, only after verify passes, published with an atomic
  swap so visitors see the old build or the new one and never a partial deploy.

`vite.config.ts` uses `base: './'`, so the same build works from a sub-path
(`/IDEV-ADMIN/`) or a root domain. Adding a custom domain later is a DNS change
plus a `CNAME` file, not a rebuild.

### Releases

Main deploys continuously; tags mark Early Access milestones. Pushing a `v*`
tag runs the verify gate and publishes a GitHub Release with generated notes:

```
git tag -a v0.1.0 -m "Early Access 0.1.0"
git push origin v0.1.0
```

A tag containing `-` is marked as a prerelease. A release can never point at a
commit that does not pass CI, because the release workflow verifies first.

Tags are created by hand on purpose: they name a milestone and record which
commit it was cut from, which is not something a CI run should decide.

`npm run check:workflows` is in the verify gate because a workflow with a YAML
syntax error is worse than a failing one. GitHub cannot read any field in it, so
it runs zero steps and its tag-only trigger silently degrades to firing on every
push. That is how `release.yml` spent its whole life broken while every other
check stayed green.

### Dependencies

Dependabot opens weekly PRs for npm and monthly for GitHub Actions. Runtime and
tooling bumps are grouped separately so framework changes are reviewed
individually while everything else moves in one pass. Every PR runs the same
`npm run verify` gate.

### Pages setup note

Pages **must** be set to **GitHub Actions** under Settings → Pages → Build and
deployment → Source. Setting it to "Deploy from a branch" publishes the
repository root instead of `dist/`, which serves the dev `index.html` and renders
a blank page, and exposes the raw source tree.

`npm run simulate -- --hours 6` extends the horizon; `-- --json` emits
machine-readable output.

## Architecture

```
src/
  game/          Simulation. No React imports.
    decimal.ts     Decimal construction helpers
    engine.ts      Tick engine, delta-clamped, mutates a throwaway clone
    formulas.ts    Cost curves, bulk buy, MAX affordability, formatting
    generators.ts  Generator definitions
    upgrades.ts    Upgrade definitions
    multipliers.ts Derived multiplier snapshot
    prestige.ts    Tech Debt curve and reset
    permUpgrades.ts Permanent (prestige) upgrades
    serialize.ts   Save format, validation, migration
    storage.ts     localStorage with backup and quarantine
    gameStore.ts   Zustand store — all actions live here
    conditions.ts  Unlock and requirement predicates
    useGameLoop.ts Simulation heartbeat
    useAutosave.ts Persistence heartbeat
  ui/            Screens and panels
  components/    Reusable cards
  __tests__/     Vitest suites
tools/
  balance-sim.ts Headless economy simulation
```

Two rules worth knowing:

`src/game/` must not import React. The engine has to stay testable in isolation.

Multipliers are always **derived** from raw state, never stored. A save can
therefore never drift from the simulation.

## Decimal handling

`break_infinity.js` has two traps that silently produce wrong numbers:

- `Decimal.ZERO` and `Decimal.ONE` **do not exist**. They are `undefined`.
- `Decimal.valueOf(x)` **is not an API**. It resolves to the inherited
  `Function.prototype.valueOf` and returns the class itself, which later throws
  `t.indexOf is not a function`.

Use `dec()`, `ONE` and `ZERO` from `src/game/decimal.ts`. Everything in the game
funnels through them so these cannot recur.

## Saves

`localStorage` keys under `idev-admin:`: `save`, `save.backup`, `save.corrupt`,
`savedAt`. A save that fails to parse is quarantined to `.corrupt` for
inspection and the `.backup` is used instead. Both slots are never overwritten
with known-bad data.

Saves written before the rename to **IDEV : ADMIN** live under `dev-idle:` and
are migrated automatically on load. The migration only runs when the current
namespace is empty, never overwrites real progress, and leaves an unreadable
legacy save in place rather than discarding it.

`GameState.version` is the save-schema version. Adding a field means bumping it,
defaulting it in `migrateBlob`, and adding a migration test with a hand-written
old-format blob. Players have real progress stored.

Export or wipe saves from the debug panel.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributors sign off with
`git commit -s` (DCO). If you change the economy, run `npm run simulate` and
include before/after numbers.

## License

[Apache-2.0](LICENSE) — Copyright 2026 Thodoris Efstathiadis.
