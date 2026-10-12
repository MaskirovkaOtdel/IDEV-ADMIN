---
PROJECT_NAME: "IDEV-ADMIN"
PROJECT_MODE: "Single-Target Standard"
ACTIVE_PHASE: "Phase 1 (Execution & Repair)"
CIRCUIT_BREAKER_STRIKES: 0
LAST_VERIFIED_SHA: "a490798"
---

# Project Execution State

## Active Goals
- [ ] Goal 1: Purge rogue GitHub release v0.6.2 and remote/local tag v0.6.2
- [ ] Goal 2: Reset local main branch to a490798 (purging schedule probes, Claude-Bot commits, and version-engine)
- [ ] Goal 3: Align package.json and package-lock.json with v0.6.1 cleanly
- [ ] Goal 4: Force-push clean main to origin
- [ ] Goal 5: Implement clean tag parity check in release.yml
- [ ] Goal 6: Implement automated release on version bump in verify-deploy.yml
- [ ] Goal 7: Run full repository verification suite (npm run verify)
- [ ] Goal 8: Verify clean git history and GitHub status

## Blockers & Anomalies
- None.
