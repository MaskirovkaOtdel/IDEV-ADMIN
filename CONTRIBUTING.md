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

Node 22 or newer. `.nvmrc` is the single source of truth for the version CI
runs. The workflows pin `node-version` literally, and `npm run check:workflows`
fails if any of them disagree with `.nvmrc`, so there is still one place to
change — enforced by the gate rather than by an action input. CI deliberately
runs the *minimum* supported version rather than whatever is newest: testing on
22 means a contributor on 24 or 26 is always running something at least as new
as the gate did. `engines` in `package.json` states the floor.

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

## Versioning and releases

A tag marks **a point in history a player should update to**, not every commit.
Most commits in this repo are CI, docs, and bug fixes that no player needs a
version for, so tagging them would only dilute the numbers.

The axis that decides the bump is **whether an existing save stays valid**, not
how important the change feels.

| Change | Bump | Reason |
|---|---|---|
| Bug fix with no effect on saved state | `0.1.1` | Existing saves load unchanged |
| New permanent upgrade, new generator tier | `0.2.0` | Progress now means something different |
| Cost, rate, or Tech Debt rebalance | `0.2.0` | Old progress is relatively wrong after it |
| Any `CURRENT_SAVE_VERSION` bump | `0.2.0` | **Always.** This is the hard line |
| Typo, CI config, docs | none | Not a release |

So `0.1.x` is the patch series and `0.2.0` is the next milestone. A hotfix
takes `0.1.1`, not `0.2.0`, even when it fixes something serious — the number
is a map of the game's shape, and noise there costs more than it buys.

### Two independent versions

These move separately and should stay separate:

- **Release version** — `package.json`, the `v*` tag, the sidebar subtitle.
- **Save schema** — `CURRENT_SAVE_VERSION` in `src/game/prestige.ts`.

Only the second one can invalidate someone's progress. Keeping them
independent is what makes a safe patch release expressible: ship `0.1.1`
through `0.1.9` with the schema untouched at `1`, then bump the schema *and*
the minor together. If they were one number, every schema change would look
like a release and "just a patch" would stop being a guarantee.

### Cutting a release

```
git tag -a v0.1.1 -m "Short player-facing summary

Detail on what changed and why it matters."
git push origin v0.1.1
```

The annotated tag message becomes the release body, so write it for someone
reading the releases page — not as a commit message. The workflow fails if the
tag has no message rather than publishing an empty release. Bump
`package.json` in the same commit so the two never drift.

Generated notes are off: this repo ships by pushing to `main`, and GitHub only
summarises merged pull requests, so auto-notes listed a Dependabot PR and none
of the actual fixes.

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
