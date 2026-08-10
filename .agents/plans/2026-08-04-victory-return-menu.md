# Victory Return Menu

## Goal

Add a `返回大厅` action beside `再来一局` on the single-player victory result card, while keeping the existing multiplayer result action unchanged.

## Acceptance

- A completed single-player victory with an exit callback shows `再来一局` and `返回大厅`.
- `再来一局` continues to start a fresh single-player match.
- `返回大厅` uses the existing session exit callback and returns to the main menu.
- Multiplayer keeps its existing single `返回联机大厅` result action and does not show a duplicate secondary button.
- Elimination/spectator controls and pause-card actions remain unchanged.
- Focused tests, required validation, browser verification, and independent review pass before commit.

## Build

- Added a focused failing test for the result action policy, then implemented the single-player secondary exit through the existing `GameHud.options.onExit` callback. Focused `gameHudActions` now passes 5/5 and full typecheck passes.
- `GameHud.showResult` keeps `再来一局` as the single-player primary action and passes `onExit` as the secondary result callback; multiplayer keeps `返回联机大厅` as its sole primary action and passes no secondary callback.
- Simplified the pre-existing result-card secondary-action interface to a fixed `返回大厅` callback. The elimination card reuses the same callback path, avoiding additional payload and preserving its existing behavior.
- Updated `docs/architecture.md` to document single-player versus multiplayer result ownership.
- Browser build and performance budgets pass without changing thresholds: browser entry `1,074,967 / 1,075,000`, all browser JS `3,771,622 / 3,900,000`, CSS `44,643 / 45,000`, dist `4,293,561 / 4,450,000`, Worker `455,919 / 460,000`, standalone `475,228 / 480,000`.
- Production-CSS browser verification used volume `0` and rendered a victory result card with `再来一局` and `返回大厅` in the existing two-column action layout (`146px 146px`). Screenshot: `/tmp/last-line-victory-return-menu.png`. The real `GameHud.showResult` call path is covered directly by the focused unit test for both single-player and multiplayer. No page console errors occurred; only expected headless software-WebGL warnings were present. The page returned to `about:blank`, preview stopped, and ports 8798/9222 were clear.

## Review

- 2026-08-04 independent review against `HEAD/main@f618ef9` passed. Scope: `src/client/ui/GameHud.ts`, `tests/unit/gameHudActions.test.ts`, `docs/architecture.md`, and this plan; static diff and affected-call-chain analysis found no blocker, high, or medium findings.
- Single-player completion preserves `再来一局` and conditionally adds `返回大厅` through the existing `GameHud.options.onExit`; that callback is supplied by `BattleRoyaleSession` from `GameApp.returnToMenu()`, which disposes and clears the active session before rendering the main menu.
- Multiplayer completion still renders only the primary `返回联机大厅` action. Its restart callback remains `MultiplayerSession.onExit`, and `MultiplayerSession.dispose()` still closes the match connection; no secondary result callback is passed online.
- The secondary-action simplification has only the two internal callers. The elimination hint, touch spectator arrows, restart action, single-player exit label, and online omission retain their prior contracts; pause-card code is unchanged.
- The focused test directly executes the real `showResult` policy for both modes and verifies callback identity. Its structural replacement of private `showResultCard` is intentionally narrow and does not independently exercise DOM click binding, but static inspection plus the recorded production-CSS browser verification cover that residual risk.
- The architecture text matches the implementation. Changed paths are limited to the requested implementation, focused test, documentation, and plan; budget/package files and thresholds are unchanged. Existing focused 5/5, full typecheck, browser build, budget, and cleaned-up browser evidence were accepted without rerunning them.
