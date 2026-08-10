# Debug Production Build Guard

## Goal

Ensure stale shell or CI environment variables can never compile single-player debug capabilities into a production artifact.

## Acceptance

- `VITE_SINGLE_PLAYER_DEBUG=true` enables debug only for Vite's development server command.
- Every Vite build command forces `__SINGLE_PLAYER_DEBUG__` to `false`, regardless of inherited environment.
- Unit coverage checks serve/build behavior directly.
- An explicit `VITE_SINGLE_PLAYER_DEBUG=true npm run build` produces no debug panel strings, styles, or chunks.
- Independent review, latest CI, and Codex review complete without unresolved blocker, high, or medium findings.

## Implementation

- Derive the compile-time constant from both Vite's `command` and the explicit environment value.
- Keep the command decision in a pure helper shared by Vite configuration and unit tests.

## Build

- Node.js 24 focused validation passes 5 files and 71 tests, including all four `serve/build × true/false` combinations.
- Node.js 24 application, Worker/test, and standalone typechecks pass.
- The explicit polluted-environment command `VITE_SINGLE_PLAYER_DEBUG=true npm run build` passes and the resulting `dist/` contains no `LOCAL DEBUG`, `单机调试面板`, `debug-menu-badge`, `debug-panel`, or `SinglePlayerDebug` payload.

## Review

- Independent static review inspected the Vite command semantics, pure guard, unit coverage, polluted-environment artifact, and preview behavior.
- The reviewer reported 0 blocker, 0 high, 0 medium, and 0 low findings and explicitly approved the guard for commit.
