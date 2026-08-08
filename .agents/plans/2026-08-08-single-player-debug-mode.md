# Single-Player Debug Mode

## Goal

Add an explicitly enabled local debug mode that makes single-player gameplay easier to inspect without changing multiplayer behavior or protocol.

## Acceptance

- `npm run dev -- --debug=true` enables the mode; ordinary development and production builds keep it disabled.
- The main menu visibly identifies that single-player debug mode is active.
- Only the local single-player session receives debug behavior. Multiplayer sessions, shared protocol, Worker, and standalone authority remain unchanged.
- The local player is immune to gunfire, grenade, and safe-zone damage while debug mode is enabled.
- An in-match debug panel shows current phase, deployment, position, health, armor, kills, weapon, and backpack state.
- The panel can land the player immediately, refill or set health/armor/kills, equip a complete test loadout, clear inventory, and grant any configured `ITEMS` entry in a chosen quantity without creating oversized backpack stacks.
- Unit tests cover command-line flag parsing, default-off behavior, damage immunity, all item kinds, legal stack splitting, immediate landing, and multiplayer isolation.
- Typecheck, unit/Worker/standalone tests, builds, budgets, muted browser verification, screenshots, and independent review complete before commit and push.

## Implementation

- Add a tiny Vite launcher that strips the application-specific `--debug=true` flag before starting Vite and exports `VITE_SINGLE_PLAYER_DEBUG=true`.
- Keep debug state mutation in a DOM-free single-player debug system. The panel emits actions and does not own authoritative state.
- Inject one debug-aware `DamageSystem` into the single-player combat, throwable, and battle-royale mode paths.
- Instantiate the panel and debug system only from `BattleRoyaleSession`; do not pass the flag to `MultiplayerSession`.

## Build

- Node.js 24.18.1 `npm run typecheck` passes for application, Worker/tests, and standalone projects.
- Focused debug and shared-damage validation passes 5 files and 70 tests after the final simultaneous-lethality fix.
- Full unit validation passes 49 files and 524 tests. Full standalone validation passes 3 files and 32 tests.
- The local Worker runtime cannot start because the host's glibc 2.28 does not satisfy the checked-in `workerd` binary's GLIBC_2.29–2.35 requirements; Worker test TypeScript compilation passes and GitHub CI remains the required real Worker gate.
- Browser, Worker dry-run, server, and standalone builds pass. Final budgets pass: browser entry `1,121,498 / 1,200,000`, largest non-entry `613,551 / 700,000`, all browser JavaScript `3,818,153 / 4,000,000`, chunks `252 / 270`, CSS `45,161 / 50,000`, entire dist `4,418,332 / 4,550,000`, Worker `553,839 / 615,000`, and standalone server `567,703 / 630,000`.
- Ordinary production builds contain no `LOCAL DEBUG`, `单机调试面板`, `debug-panel`, or `SinglePlayerDebug` payload. A debug build produces a separate `SinglePlayerDebugPanel` chunk and dynamically loads its stylesheet.
- Chrome verification used `npm run dev -- --debug=true --port 8797 --strictPort` with volume `0`. It confirmed the menu badge, F10 pointer-lock release, real panel clicks, immediate landing, test loadout, editable kills, arbitrary grenade grants split into legal three-item stacks, grenade selection and consumption from 11 to 10, and 100 health/armor after the nearby explosion. Default `npm run dev` showed no badge or panel. Final console output contained no application error or form issue; only the environment's software-WebGL warning remained.
- Screenshots were captured at `/tmp/last-line-debug-menu.png`, `/tmp/last-line-debug-panel-loadout.png`, `/tmp/last-line-debug-arbitrary-grant.png`, `/tmp/last-line-debug-grenade-selected.png`, `/tmp/last-line-debug-post-grenade.png`, and `/tmp/last-line-debug-final-panel.png`.
- Every browser verification page was returned to `about:blank`, its isolated page was closed, and port 8797 was stopped immediately after the round.

## Review

- Round 1 static review found one medium stale test-contract assertion and one low documentation wording mismatch. The test now checks the actual compile-time constant and gated dynamic imports, and architecture documentation distinguishes `GameApp` presentation from `BattleRoyaleSession` debug authority.
- Round 2 found one medium simultaneous-lethality issue: the old pre-damage all-dead calculations could give a Bot the deterministic 1 HP fallback even though the debug player was immune. `DamageSystem.wouldBeLethal()` now owns the immunity-aware prediction used by gunfire, grenades, and safe-zone damage, with three direct system regressions.
- Round 3 independent static re-review reported 0 blocker, 0 high, 0 medium, and 0 low findings and explicitly approved the change for commit.
