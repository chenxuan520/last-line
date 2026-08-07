# Project Agent Guide

## Goal

Maintain a browser battle royale with one human and 49 AI actors in single-player, or 2–10 humans with AI filling a 50-actor authoritative multiplayer room. Preserve the complete aircraft-to-result loop, desktop/mobile input parity, and the boundary between authoritative rules and client presentation.

## Commands

```bash
npm ci
npm run typecheck
npm run test
npm run test:multiplayer:production
npm run test:coverage
npm run build
npm run build:worker
npm run build:server
npm run build:standalone
npm run check:budgets
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
- Seeded tree-trunk positions and counts are authoritative and quality-independent. Movement, combat/LOS, navigation, dynamic drops, server authority, and client presentation must consume the same `MapLayout.treeTrunks`; foliage may vary in mesh precision but remains visual-only.
- Map identity is explicit (`mapId`) and independent from `mapSeed`. Never encode map kind in seed sign bits, ranges, or special values. Every state-driven layout cache must key by both map ID and seed; missing persisted map IDs normalize to the island.
- The mixed-region map always contains six named macro regions: one fixed dense town with the sole hospital, one fixed sparse rural area, one fixed mountain forest, and three seed-selected town/rural/forest regions. Their enlarged near-square centers must form a compact irregular seeded cluster, never fixed rows, columns, or rectangular slots; the center bounding box is capped below the former grid footprint, and exactly five short connector roads form a non-crossing connected backbone without cutting through a third region's developed core. Buildings, authoritative trees, rocks, hay, and regional loot use explicit nearest-region ownership rather than ambiguous overlapping footprint inference; town building coverage remains at least 38% of that nearest-owned footprint, and type-specific landing zones remain navigable public spaces. Region kind, terrain hills including their full radii, roads, urban presentation roads, geometry, loot, navigation, and presentation must remain inside the map and consume the same seeded blueprint; forest tree/rock footprints must bound terrain variation and placement offset rather than center-sample steep slopes, and no code-facing map ID may use Chinese pinyin. Keep these generator-shape and anti-regression details in engineering guidance and architecture documentation, not in README product copy.
- Every map has exactly one authoritative hospital and one different authoritative ammunition depot. Every interior depot story contributes one fixed stack for each weapon ammo type outside the existing 250-record global loot budget; layout, battle-royale initialization, AI, replication, persistence, HUD, and rendering must consume its explicit building and per-level loot indexes rather than infer array tails.
- Every building, including one-story buildings, has an internal stairwell and one authoritative ramp per story leading through floor/roof openings. Exterior scaffold ramps are forbidden; movement support, combat/LOS, navigation, loot clearance, and rendering must consume only the shared internal ramps.
- High-rise floors and skybridges are authoritative map geometry. Movement support, combat/LOS, navigation, server authority, and rendering must consume the same floor, wall, opening, ramp, and skybridge records; never ship a presentation-only bridge or floor.
- Greyfurnace streets must remain one connected seeded graph with bounded-jitter arterial backbones, local T junctions, bends, and merged visual blocks; never regress to full-span orthogonal grid lines. Buildings, POIs, cover, authoritative trees, terrain roads, minimap roads, and visual details must consume or clear the same `MapLayout.roadSegments` shoulder footprint.
- All map families must render the complete five-asset brand-sign set at deterministic, map-appropriate semantic anchors. Island anchors remain stable; town and mixed maps use their own residential/town, industrial/forest, and warehouse/rural POIs. Brand signs stay presentation-only, non-pickable, non-colliding, terrain-safe, and must fail explicitly rather than silently disappear when an anchor or clear placement is unavailable.
- Keep `GameMode` generic. Battle royale behavior belongs in `BattleRoyaleMode`; do not speculate about future 5v5 rules.
- Cloudflare and standalone multiplayer must share protocol, gateway, lobby, room, account, administrator, and match-domain logic. Platform-specific code is limited to storage, alarm, socket, HTTP, and process-lifecycle adapters; never fork gameplay or copy a second service implementation.
- The browser selects a backend only by URL (`same-origin` for full-stack standalone). It must not branch on Cloudflare versus standalone gameplay semantics.
- Multiplayer may predict only reversible local firing presentation. Hits, ammunition, damage, and death stay server-authoritative; human hitscan rewind must use monotonic server-issued render ticks, retain at most the documented 200ms actor-capsule window, and keep current authoritative map occlusion. Single-player and Bot shots remain current-state queries.
- Multiplayer airborne presentation must use deployment-aware correction budgets and interpolate the external aircraft between snapshots; do not apply the grounded 6m snap threshold to valid aircraft/parachute motion. Ground-loot replication uses a horizontal 400m footprint while airborne and 60m while grounded, with transition-only deltas; interaction remains authoritative 3D distance.

## Server Rules

- Preserve the public HTTP/WebSocket protocol across Cloudflare Worker and standalone Node.js. Internal object routes must never be exposed by the standalone HTTP server.
- Standalone is intentionally one server and one Node.js process. Local SQLite is authoritative, and the exclusive lock database must reject a second live process while remaining crash-recoverable.
- Keep alarm delivery at least once: persist alarm ownership until the handler completes, and use generations so an old invocation cannot delete a reschedule. Every persisted room state must have a recoverable alarm path.
- Reconnect-token rotation is two-phase. A previous or presented pending token remains usable until `connection.ack` promotes the token issued in `welcome`.
- Close expired/finished rooms, release sockets and runtime state, and evict dormant local room services. Do not retain completed 50-actor matches indefinitely.
- Reconstruct standalone requests only under `SERVER_PUBLIC_ORIGIN`; reject absolute/network-path targets before auth or same-origin checks. Trust forwarded client IPs only when every direct peer is a trusted proxy.
- On shutdown, stop room loops and checkpoint before bounded HTTP/WebSocket draining. Database and process-lock cleanup belongs in `finally`, including startup-failure paths.
- Keep operational metrics observational and low-cardinality. `active_rooms`, `tick_delay_ms`, `websocket_buffered_bytes`, and `checkpoint_duration_ms` use versioned structured logs only; never add room/account/IP/token labels, persist metrics into checkpoints, or expose a public metrics route. Cloudflare buffering must be reported as unavailable when the platform does not expose it.
- Multiplayer room map selection is immutable after room creation. Quick match must only join public waiting rooms with the requested map ID; direct code joins inherit the room map.

## Asset Rules

- Gameplay and rendering code reference stable asset IDs, never concrete asset paths.
- Preloaded image assets must be consumed from the validated `AssetCatalog` payload rather than fetched again during scene creation. World textures may enhance a material only as non-blocking resources; missing or failed textures must leave authoritative geometry immediately renderable with its procedural color/vertex fallback instead of hiding the mesh.
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
- Mobile fullscreen and orientation locking must originate from a real user activation. Never call `requestFullscreen()` from `orientationchange`; unsupported or rejected browsers must retain manual landscape gameplay and a usable retry path.
- Run both Worker and standalone contract suites after changing shared multiplayer classes. Standalone regressions must cover real HTTP/WebSocket behavior, persistence/restart, process locking, alarm generations, reconnect grace, room eviction, and bounded shutdown; use deterministic barriers for races instead of timing-only assertions.
- Keep `test:multiplayer:production` as a real public HTTP/WebSocket smoke, separate from coverage. It must create a private room, validate the deployed welcome protocol and lobby state, then leave; run it after every production Worker or Pages deployment. The scheduled production-smoke workflow is drift detection, not an atomic deployment gate.
- Never let a generic WebSocket `closed` status overwrite a specific terminal multiplayer error. Protocol mismatch, room closure, account revocation, and similar terminal causes must remain the final visible message and provide a usable path back to the multiplayer menu.
- Multiplayer firing regressions must cover local cadence/magazine limits, predicted-versus-authoritative effect deduplication, optional legacy render ticks, monotonic socket bounds, historical actor hits, the rewind cap, and current-map obstruction.
- Human connection notices must be sequenced, transition-idempotent, display-name-only, and shared by Worker/standalone close and reconnect paths. Desktop Tab+wheel must scroll the leaderboard without changing weapons; pause exits must return single-player to the main menu and multiplayer to the online lobby while closing the match connection.
- Desktop multiplayer actions that can start a match or public countdown must request pointer lock synchronously from that real user activation, retain it across asynchronous admission/scene loading, and release it on lobby/menu/error exits. Single-player and multiplayer session resume paths must share the safe optional/synchronous/legacy-Promise pointer-lock helper; never rely on an asynchronous lobby or `match.full` callback to create the first lock. Touch clients must remain isolated from pointer lock, and rejection must preserve the usable `继续游戏` fallback.
- Multiplayer admission is single-flight across quick match, room creation, code joins, and public-room entries. Disable every admission entry synchronously, invalidate stale attempts when leaving the menu, and let connection status/message handlers mutate UI, fullscreen, or pointer lock only while their connection is still the active `GameApp.multiplayerConnection`.
- Persisted match checkpoints are compatible only at the current checkpoint version and when their complete recoverable state shape is present, including exactly the configured 50 actors, matching actor record keys and `actor.id` values, and every canonical initial loot key derived from the checkpoint's explicit `mapId + mapSeed`; additional valid dynamic loot records remain allowed. Persisted members must be complete `RoomMemberRecord` objects whose record keys equal `playerId`; identity, display name, admission/reconnect credentials, account/session pairing, booleans, timestamps, connection epoch, and actor ID types are validated before use. Running/finished rooms must retain 2–10 non-null, unique actor IDs equal to the checkpoint's complete `kind: "player"` actor set; no member may point to a bot or share an actor. Missing, null, array, partial, malformed, or older-version state is incompatible and must be deleted without throwing on both Worker and standalone.
- Performance gates must use deterministic operation, protocol-byte, scene-resource, and raw-artifact counts. Do not hard-gate wall-clock duration, FPS, heap usage, or compressed sizes; changing a checked-in budget requires an explicit architecture/resource review.
- Coverage is measured separately by source ownership: V8 for `src/` and `standalone/`, Istanbul for the Cloudflare `worker/` runtime. Keep all business source files in scope, write reports only under the ignored `node_modules/.cache/coverage/`, and treat lowering a checked-in threshold as a reviewed quality decision rather than hiding uncovered code.

## Review and Delivery Rules

- **Remember to start an independent `code-reviewer` before every commit unless the user explicitly skips review for that task.** Run it after implementation and validation; self-review and passing tests are not substitutes. Reviewers are read-only, must not mutate Git or files, and should analyze the diff/contracts without repeating already recorded full validation.
- The post-commit hook reminds the agent to double-check this requirement. If review was missed, start an independent `code-reviewer` before push, deployment, or completion report.
- Reviewers must not repeat test, typecheck, build, budget, smoke, or browser commands that the outer implementation agent already completed and recorded in the active plan. Reviewer work defaults to static diff/contract analysis; it may run only the smallest targeted verification for a specific uncovered risk, and must state why existing evidence is insufficient. Never rerun full suites merely for independent confirmation.
- Review subagents are read-only Git reviewers: they must never checkout or switch branches, stash, reset, add, commit, amend, rebase, push, force-push, or delete remote branches. Only the outer agent may mutate repository or remote Git state, and every subagent report must be verified locally before acting on it.
- Before creating a commit, inspect `git status -sb`, `git log --oneline -n 10`, and the exact `git ls-remote --heads origin <branch>` target; preserve or stash worktree changes, then run `git pull --rebase` first so the commit is based on the current remote tip. Resolve conflicts and re-check the diff before committing, then push only after the commit is verified. If a commit must be removed, use a non-destructive parent reset that preserves files, then verify the worktree before any new commit. Never force-push or rewrite remote history unless the user explicitly names that exact operation.
- When a pull, rebase, or merge conflict occurs, resolve it on the current user-specified branch; never create or switch to a new branch unless the user explicitly requests it.
- Before deleting a remote branch, confirm the exact branch name and explicit user intent, run the deletion once, then fetch with prune and verify the ref is absent. A reviewer or subagent claiming that it committed, pushed, reset, or deleted a branch is not evidence that the outer worktree or remote state changed.
- Re-read the current plan before evaluating findings. Treat reviewer feedback as input to verify against requirements, compatibility, existing semantics, and code; do not apply it mechanically.
- Resolve every blocker, high, and medium finding, then request re-review. Do not commit, push, deploy, or report completion while any such finding remains, unless the plan records a specific, evidence-backed reason that no code change is required.
- Before the associated implementation commit is created, record completed review rounds and finding dispositions in the current plan's `## Review`, and record only facts already known at that time under `## Build`. These records must be included in the same commit as the implementation. The commit is the cutoff for that implementation cycle: facts learned at or after commit time must be reported to the user and must not be backfilled into that cycle. A genuinely new user-requested task may reuse the same plan and append a new cycle, but must preserve prior records and never backfill an earlier cycle.
- **Never create a plan-only commit.** Immediately before every commit, inspect the staged paths. If the staged set is non-empty and every staged path is under `.agents/plans/`, stop: the commit is forbidden. Do not bypass or disable the hook, add a meaningless non-plan file, amend another commit, rewrite history, or create a follow-up commit to carry the plan records. Plan Build/Review records must be finalized before the associated implementation commit and included in that same commit. There are no exceptions.
- After an implementation-cycle commit has been created, treat the repository as read-only for that completed cycle. Do not edit its plans, documentation, code, configuration, tests, workflows, or hooks; do not create a follow-up commit; and do not amend, rewrite, or force-push its history. Post-commit CI/deployment monitoring and verification are read-only. Repository changes may resume only for a genuinely new user-requested change with its own non-plan deliverable; that new cycle may reuse the same plan without backfilling the completed cycle. Finishing records, cleanup, or documenting deployment is not a new change.
- Pure documentation or plan-record changes that do not alter executable code, workflow/configuration behavior, contracts, security, or deployment behavior do not require an independent reviewer unless the user explicitly requests one. Workflow files, Dockerfiles, build scripts, and runtime configuration are executable changes, not documentation-only changes.
- Keep engineering documentation current in the same change. Update `AGENTS.md`, README, and relevant `docs/` whenever architecture, contracts, security, persistence, deployment, commands, or long-term validation rules change.
- Immediately after each Chrome/Edge MCP verification—not later at task completion—actively close every page/context opened for that verification, stop every local server it started, and confirm only the unavoidable `about:blank` page remains before continuing other work. Never leave an opened verification page, browser context, render loop, or local server running between verification rounds. Keep volume at `0` throughout.

## Completion Checklist

1. Run `npm run typecheck`.
2. Run `npm run test`.
3. Run `npm run build`.
4. Run `npm run build:worker` and `npm run build:server` when multiplayer/shared server code changed; run `npm run build:standalone` when the self-hosted artifact or same-origin client selection changed.
5. Run `npm run check:budgets` after producing the browser, Worker, and standalone artifacts.
6. If presentation changed, open the production build in local Chrome/Edge with volume `0` and check the console.
7. Complete the review/re-review loop with no unresolved blocker, high, or medium findings, unless the user explicitly instructed the agent to skip review for that task.
8. Update `AGENTS.md`, README, and `docs/` when contracts, controls, commands, architecture, persistence, security, or deployment behavior change.

## Deployment Rules

- Keep `.github/workflows/ci.yml` on Node.js 24 and lockfile installs.
- Pull requests and every branch push run the core CI checks; only `main` deploys the verified `dist/` artifact to GitHub Pages.
- Cloudflare Pages uses dashboard Git integration with `main`, `npm run build`, and output directory `dist`.
- Cloudflare Workers Builds must also track `main` and run the documented Worker build and deploy commands. A successful repository push or Pages deployment never proves that the Worker deployed.
- Any change touching `worker/`, shared multiplayer server code, or `MULTIPLAYER_PROTOCOL_VERSION` is incomplete until `wrangler deployments status` shows a new production Worker version created for that release and `npm run test:multiplayer:production` passes against the public endpoint. Deployment verification never grants permission to modify the repository for the completed implementation cycle. If a Worker version ID or smoke result is already known before that cycle's commit, it may be recorded in the plan and included with the implementation. Otherwise it belongs only in the user-facing report: never edit the plan solely to insert it, never create a follow-up documentation commit, and never amend or rewrite the implementation commit. A later genuine task may reuse the same plan, but must not backfill the earlier cycle's deployment facts. If automatic Worker deployment did not occur, report it as a blocker and use the verified `npm run deploy:worker` fallback; never silently leave Pages and Worker on different revisions.
- Keep `npm run deploy:worker` as the verified fallback chain: Worker typecheck, Worker tests, dry-run bundle, deployment, then the real production HTTP/WebSocket smoke. Do not replace it with a bare `wrangler deploy` for normal releases.
- Worker deployment verification may retry only the side-effect-free `/health` protocol marker and transient transport/gateway failures while a newly deployed version propagates to the public custom domain. Keep that wait bounded; once the marker matches, create exactly one smoke room and never retry guest, room, WebSocket, or leave failures.
- Worker and Pages deployments are not atomic. A protocol-version change requires a documented maintenance rollout: disable new multiplayer entry, drain or close rooms, deploy and smoke the Worker, deploy the matching Pages client, then re-enable entry and smoke again. Never independently roll strict protocol versions and assume CI ordering makes them compatible.
- Do not add Cloudflare long-lived credentials to the repository when Git integration is available.
- Keep Vite asset URLs compatible with both the GitHub `/last-line/` subpath and the Cloudflare root domain.
- Standalone production uses Node.js 24, a same-origin browser build, HTTPS reverse proxying with WebSocket support, and a persistent data volume. Keep Cloudflare and standalone data independent unless an explicit migration is designed.
- Never commit `.env.standalone`, administrator recovery/bootstrap values, SQLite data, WAL files, cookies, admission/reconnect tokens, or proxy credentials.
- Docker/Compose changes require a container smoke when Docker is available. If it is unavailable, record that gap and still verify the native bundle, real HTTP/WebSocket flow, graceful shutdown, and crash-lock recovery.
- CI must build the production Docker image without registry credentials and run the image read-only as a non-root user with temporary writable mounts, then require the exact `/health` response before Pages or release artifacts proceed.
- Version tags must pass the complete build and container smoke before GitHub Actions may publish the multi-architecture standalone image to Docker Hub. Registry credentials belong only in `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` Actions Secrets; never print, persist, or pass them as Docker build arguments.
