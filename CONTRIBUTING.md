# Contributing to IDEV : ADMIN

Thanks for your interest. This document covers the mechanics of contributing.

## Sign your work (DCO)

All commits must carry a [Developer Certificate of Origin](https://developercertificate.org/) sign-off:

```
git commit -s -m "your message"
```

The `-s` flag adds a `Signed-off-by:` trailer certifying that you have the right to submit the code under the project's Apache-2.0 license. If you omit it, your pull request cannot be merged.

Note the distinction from a CLA: with a DCO you retain copyright in your contribution and grant it under Apache-2.0. No separate legal agreement is required.

## Getting set up

```
npm install
npm run dev
```

The app runs at `http://localhost:5173` by default. Press `Escape` to toggle the in-game debug panel.

## Before you open a pull request

Run the full gate. It must pass cleanly:

```
npm run verify
```

That runs, in order:

| Step | Command | What it checks |
|---|---|---|
| Lint | `npm run lint` | oxlint; React and correctness rules |
| Typecheck | `npm run typecheck` | `tsc -b`, zero errors, `noUnusedLocals` enabled |
| Workflows | `npm run check:workflows` | Every `.github/workflows/*.yml` parses and declares the shape CI needs |
| Tests | `npm test` | Vitest across engine, economy, save, and UI integration |
| Build | `npm run build` | Production bundle compiles |

If you touch the economy, add or update a test in `src/__tests__/`. The suite is the regression net, and a change that alters generator costs, upgrade multipliers, the prestige curve, or the save format without a corresponding test will be asked for one.

## Where things live

| Path | Contents |
|---|---|
| `src/game/` | Simulation: engine, formulas, economy data, store, save/load |
| `src/ui/` | Screens and panels |
| `src/components/` | Reusable interactive cards |
| `src/__tests__/` | Vitest suites |
| `tools/` | Balance simulation (see below) and the workflow YAML check |
| `.github/` | Actions workflows and Dependabot config |

`src/game/` holds no React imports. Keep it that way: the engine must stay testable in isolation and reusable outside the UI.

## Balance changes

The economy is tuned against a target of roughly 45–60 minutes to the first meaningful prestige. If you change generator costs, production rates, upgrade effects, or the Tech Debt curve, run the simulation and report the numbers before and after:

```
npm run simulate
```

Include the output in your pull request description. A balance change without measured before/after numbers is very likely to get pushback, however reasonable it sounds.

## Save format compatibility

`GameState.version` is the save-schema version and is bumped whenever serialization changes. If you add a save field:

1. Add it to `SaveBlob` in `src/game/types.ts`
2. Serialize and deserialize it in `src/game/serialize.ts`
3. Give it a default in `migrateBlob` so older saves load cleanly
4. Add a migration test with a hand-written old-format blob

Players have real progress saved in `localStorage`. A change that makes an old save silently lose progress is a bug, not a breaking change.

## Style

Match the surrounding code. Comments explain *why*, not *what* — especially where a non-obvious choice exists to work around a library quirk. `src/game/decimal.ts` is the reference example: it documents a trap in `break_infinity.js` that cost real debugging time.

## Reporting bugs

Include what you did, what happened, what you expected, and your browser and Node versions. If it involves save data, the exported save string from the debug panel is the most useful thing you can attach.

## Code of conduct

Be decent to each other. Assume good faith, critique code rather than people, and accept that maintainers may decline a change for reasons of game design rather than technical merit.
