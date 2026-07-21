# Architecture

## Runtime Flow

`GameApp` loads the asset catalog, restores settings, and exposes two isolated session paths. `BattleRoyaleSession` remains the local single-player authority. `MultiplayerSession` owns only input, prediction, interpolation, Babylon presentation, HUD, and a WebSocket connection; it never creates a `GameSimulation`.

Each fixed step follows this order:

1. Controllers produce `ActorCommand` values.
2. Movement commands update authoritative positions and deployment state.
3. Inventory actions resolve with tick-rotated conflict ordering.
4. Combat intents are collected and damage is settled as a batch.
5. `BattleRoyaleMode` advances flight, safe zones, zone damage, and results.
6. Dead inventories become reusable ground-loot records.
7. Rendering synchronizes from the resulting state.

In multiplayer, the same steps run inside one `GameRoom` Durable Object at 30 Hz. Browsers send validated `ActorCommand` values and receive a full initial state followed by 10 Hz actor frames, loot changes, sequenced events, and input acknowledgements.

## Authoritative Rules

`src/game/` has no DOM or Babylon dependency. `MatchState` contains serializable actors, inventories, ground loot, flight, safe zone, phase, and result data.

`SimulationCombatWorld` performs hitscan and line-of-sight tests against fixed actor capsules, generated wall segments, roof caps, ramps, and shared terrain data. Babylon meshes only present the state and never decide a hit.

Simultaneous lethal damage uses a deterministic tick-based selector. The selected survivor still receives normal damage, armor reduction, and events, with health clamped to 1 only when every remaining actor would otherwise die in the same tick.

## Controllers

`HumanController` maps keyboard, mouse, and touch state to the same `ActorCommand`. `TouchInputAdapter` only tracks bounded Pointer Event state for the movement joystick, look region, fire hold, and one-shot HUD actions; it never reads or mutates authoritative match state. Portrait rotation, page hiding, pause, healing, and disposal clear held touch state to prevent stuck movement or fire.

Each `BotController` has independent decision timers and memory. Bots use the same commands and systems as the player for movement, looting, firing, reloading, switching weapons, and healing.

## Rendering

`IslandScene` builds the 2400m island from per-match seeded map points: eight irregular named POIs, eight wilderness compounds, nearest-neighbor roads, randomly scattered enterable buildings, variable-density loot, dense natural details, procedural actors, a terrain-following safe-zone ribbon, and weapon-specific first-person/third-person models. Ground loot optionally uses 14 shared low-poly geometry templates; each loot record still owns one reusable mesh and switches shared geometry/material in place when its record generation changes. `MapLayout.hospital` deterministically reuses one existing building as a white two-story hospital, adds a visual-only medical cross and minimap marker, and relocates two existing supplemental medical records to its reachable ground floor without increasing building or loot counts. The player camera applies scope FOV only while a sniper is active and the right mouse button is held or touch ADS is toggled.

Optional GLB models are loaded asynchronously and instantiated as non-pickable visual children. Procedural models remain the fallback. Repeated loot drops reuse inactive state IDs and marker meshes, and scene disposal clears marker references and imported containers.

`IslandScene` receives an explicit local actor ID for multiplayer. Only that actor uses the first-person hitbox representation; remote human actors use the same third-person presentation contract as AI while retaining `kind: "player"` in authoritative state.

## Multiplayer Services

`LobbyDirectory` is a singleton Durable Object that owns temporary guest sessions, public room summaries, quick matching, and private room-code lookup. Every room has a separate `GameRoom` Durable Object that owns lobby readiness, WebSockets, actor assignment, checkpoints, and one `MatchRuntime`.

`AccountDirectory` is a SQLite-backed Durable Object for persistent player accounts. It implements case-insensitive unique usernames, native WebCrypto PBKDF2-SHA-256 password records at Cloudflare's supported 100,000-iteration ceiling, opaque access/refresh sessions, refresh rotation, logout, account lookup, password changes, disabling, and session revocation. Public auth routes expose only short-lived access tokens; refresh tokens remain in `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookies.

`AdminDirectory` owns one administrator identity, eight-hour opaque Cookie sessions, and the global multiplayer admission policy. The Worker serves a same-origin `/admin` terminal with a strict CSP. Bootstrap and forgotten-password recovery use separate one-time Worker Secrets; every mutation requires same-origin requests, and internal account/room operations require a separate capability secret. Optional Turnstile validation becomes fail-closed only when both the site and secret keys are configured.

When registration/login is required, the gateway validates the player access token before creating a guest-compatible room identity. That identity retains the account ID and session revision; Lobby and GameRoom revalidate linked accounts so disabling or revoking an account invalidates matchmaking, admissions, reconnects, and active sockets. Toggling the global policy does not interrupt pre-existing unlinked guest rooms.

`MatchRuntime` reuses `GameSimulation`, `BattleRoyaleMode`, `SimulationCombatWorld`, and `BotController`. Matches contain 2–10 stable human actors and enough bots to total 50. AI decisions are distributed across three deterministic cohorts while movement and all authoritative systems remain 30 Hz. Disconnected humans receive idle input, then server-side bot takeover without changing actor identity.

`CommandInbox` rejects stale sequences, expires continuous input, and consumes jump, interact, reload, switching, item use, and drops only once. The client predicts only local movement and replays unacknowledged inputs after each server correction; combat, inventory, healing, damage, loot, safe zones, and results are never predicted.

## Performance Strategy

- Fixed 30 Hz rules with decoupled rendering
- Staggered AI decisions based on distance
- Bounded multi-wall path search with per-Bot path reuse
- Shared procedural materials and cloned loot/tree meshes
- Quality-dependent hardware scaling
- No dynamic shadows or full rigid-body simulation
- Dynamic GLTF loader chunk only when a manifest entry uses GLB
- Active multiplayer rooms use one single-threaded Durable Object, 30 Hz rules, 10 Hz snapshots, and one-second checkpoints
- Lobby sockets use the Durable Object WebSocket API and may hibernate while no match timer is active

## Boundaries

Single-player never opens a network connection and pauses when desktop pointer lock or touch input is inactive. Multiplayer is server-authoritative and continues while a touch client is paused, hidden, or portrait-oriented; that client settles to idle input. Mobile gameplay requires landscape orientation. There are no social features, rankings, server-side lag-compensated hit rewind, or speculative future 5v5 rules.
