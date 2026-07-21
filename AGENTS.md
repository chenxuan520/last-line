# Project Agent Guide

## Goal

Maintain a browser battle royale with one human and 49 AI actors in single-player, or 2–10 humans with AI filling a 50-actor authoritative multiplayer room. Preserve the complete aircraft-to-result loop, desktop/mobile input parity, and the boundary between authoritative rules and client presentation.

## Commands

```bash
npm ci
npm run typecheck
npm run test
npm run build
npm run build:worker
npm run build:server
npm run build:standalone
npm run preview
```

`npm run test` is Vitest only. Do not add Playwright, install Playwright browsers, or download Chromium for this project. Browser checks must use the locally installed Chrome/Edge. Set game volume to `0` before any browser test.

## Architecture Rules

- `src/game/` must not import DOM or Babylon modules.
- Core state must remain JSON-serializable and use stable entity IDs.
- Human and bot controllers only produce `ActorCommand`; they must not mutate authoritative state.
- Movement, combat, inventory, damage, safe-zone, and result logic belong in rule systems or modes.
- Use `SimulationCombatWorld` for authoritative hit tests and line of sight. Rendering meshes are never gameplay hitboxes.
- Process simultaneous actions independently of command insertion order and actor kind.
- Keep `GameMode` generic. Battle royale behavior belongs in `BattleRoyaleMode`; do not speculate about future 5v5 rules.
- Cloudflare and standalone multiplayer must share protocol, gateway, lobby, room, account, administrator, and match-domain logic. Platform-specific code is limited to storage, alarm, socket, HTTP, and process-lifecycle adapters; never fork gameplay or copy a second service implementation.
- The browser selects a backend only by URL (`same-origin` for full-stack standalone). It must not branch on Cloudflare versus standalone gameplay semantics.

## Server Rules

- Preserve the public HTTP/WebSocket protocol across Cloudflare Worker and standalone Node.js. Internal object routes must never be exposed by the standalone HTTP server.
- Standalone is intentionally one server and one Node.js process. Local SQLite is authoritative, and the exclusive lock database must reject a second live process while remaining crash-recoverable.
- Keep alarm delivery at least once: persist alarm ownership until the handler completes, and use generations so an old invocation cannot delete a reschedule. Every persisted room state must have a recoverable alarm path.
- Reconnect-token rotation is two-phase. A previous or presented pending token remains usable until `connection.ack` promotes the token issued in `welcome`.
- Close expired/finished rooms, release sockets and runtime state, and evict dormant local room services. Do not retain completed 50-actor matches indefinitely.
- Reconstruct standalone requests only under `SERVER_PUBLIC_ORIGIN`; reject absolute/network-path targets before auth or same-origin checks. Trust forwarded client IPs only when every direct peer is a trusted proxy.
- On shutdown, stop room loops and checkpoint before bounded HTTP/WebSocket draining. Database and process-lock cleanup belongs in `finally`, including startup-failure paths.

## Asset Rules

- Gameplay and rendering code reference stable asset IDs, never concrete asset paths.
- Gameplay values remain in `src/config/`; model metadata must not change damage, fire rate, inventory, or hit volumes.
- GLB models are visual-only and non-pickable. Keep procedural fallbacks enabled unless loading, mesh validation, and required-node validation all succeed.
- Preserve typed fallback checks and actual SVG/image decode validation.
- Reuse inactive ground-loot records and marker meshes; do not introduce unbounded per-drop allocations.

## AI Rules

- AI obeys the same movement, ammunition, damage, inventory, healing, and safe-zone rules as the player.
- Perception must pass range, view, and `SimulationCombatWorld` line-of-sight checks.
- Loot targets must be navigable. Empty paths must cause target reselection, not direct movement through obstacles.
- Unarmed bots search the full map for reachable weapons. Empty bots search for compatible ammunition and may discard an incompatible stack when full.
- Keep per-bot decision state independent and stagger distant updates.

## Testing Rules

- Add a failing Vitest before fixing rule regressions when practical.
- Keep deterministic tests by injecting random sources.
- Cover both command insertion orders for simultaneous conflicts.
- Use fast battle royale config for full-match tests; keep production timing assertions separate.
- Use Babylon `NullEngine` for scene, GLB, and lifecycle tests.
- Do not weaken multi-seed AI thresholds to hide navigation or looting failures.
- Do not play audio during automated or manual verification.
- Run both Worker and standalone contract suites after changing shared multiplayer classes. Standalone regressions must cover real HTTP/WebSocket behavior, persistence/restart, process locking, alarm generations, reconnect grace, room eviction, and bounded shutdown; use deterministic barriers for races instead of timing-only assertions.

## Completion Checklist

1. Run `npm run typecheck`.
2. Run `npm run test`.
3. Run `npm run build`.
4. Run `npm run build:worker` and `npm run build:server` when multiplayer/shared server code changed; run `npm run build:standalone` when the self-hosted artifact or same-origin client selection changed.
5. If presentation changed, open the production build in local Chrome/Edge with volume `0` and check the console.
6. Update `AGENTS.md`, README, and `docs/` when contracts, controls, commands, architecture, persistence, security, or deployment behavior change.

## Deployment Rules

- Keep `.github/workflows/ci.yml` on Node.js 24 and lockfile installs.
- Pull requests run checks only; `main` deploys the verified `dist/` artifact to GitHub Pages.
- Cloudflare Pages uses dashboard Git integration with `main`, `npm run build`, and output directory `dist`.
- Do not add Cloudflare long-lived credentials to the repository when Git integration is available.
- Keep Vite asset URLs compatible with both the GitHub `/last-line/` subpath and the Cloudflare root domain.
- Standalone production uses Node.js 24, a same-origin browser build, HTTPS reverse proxying with WebSocket support, and a persistent data volume. Keep Cloudflare and standalone data independent unless an explicit migration is designed.
- Never commit `.env.standalone`, administrator recovery/bootstrap values, SQLite data, WAL files, cookies, admission/reconnect tokens, or proxy credentials.
- Docker/Compose changes require a container smoke when Docker is available. If it is unavailable, record that gap and still verify the native bundle, real HTTP/WebSocket flow, graceful shutdown, and crash-lock recovery.
