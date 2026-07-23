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

In multiplayer, the same steps run inside one platform-hosted `GameRoom` at 30 Hz. Cloudflare assigns one Durable Object per room; standalone assigns one in-process room service backed by local SQLite. Browsers use the same protocol in both modes and receive a full initial state followed by 10 Hz actor frames, loot changes, sequenced events, and input acknowledgements.

## Authoritative Rules

`src/game/` has no DOM or Babylon dependency. `MatchState` contains serializable actors, inventories, ground loot, flight, safe zone, phase, and result data.

`SimulationCombatWorld` performs hitscan and line-of-sight tests against fixed actor capsules, generated wall segments, roof caps, ramps, authoritative tree trunks, and shared terrain data. Tree-trunk positions and dimensions are regenerated from `mapSeed`, shared by single-player, server authority, and every client, and are also consumed by movement, Bot navigation, retreat-cover selection, and dynamic-loot placement. Babylon meshes only present the state and never decide a hit; foliage remains visual-only.

Simultaneous lethal damage uses a deterministic tick-based selector. The selected survivor still receives normal damage, armor reduction, and events, with health clamped to 1 only when every remaining actor would otherwise die in the same tick.

## Controllers

`HumanController` maps keyboard, mouse, and touch state to the same `ActorCommand`. `TouchInputAdapter` only tracks bounded Pointer Event state for the movement joystick, look region, fire hold, and one-shot HUD actions; it never reads or mutates authoritative match state. Portrait rotation, page hiding, pause, healing, and disposal clear held touch state to prevent stuck movement or fire. `MobileFullscreenController` requests fullscreen synchronously from a real start/retry click, then attempts a landscape orientation lock when supported. It never requests from `orientationchange`; rejected, unsupported, or exited fullscreen falls back to manual rotation and a non-blocking HUD retry action.

Each `BotController` has independent decision timers and memory. Bots use the same commands and systems as the player for movement, looting, firing, reloading, switching weapons, and healing.

## Rendering

`IslandScene` builds the 2400m island from per-match seeded map points: eight irregular named POIs, eight wilderness compounds, nearest-neighbor roads, randomly scattered enterable buildings, variable-density loot, 384 authoritative tree trunks with visual foliage, dense natural details, procedural actors, a terrain-following safe-zone ribbon, and weapon-specific first-person/third-person models. Ground loot optionally uses 14 shared low-poly geometry templates; each loot record still owns one reusable mesh and switches shared geometry/material in place when its record generation changes. `MapLayout.hospital` deterministically reuses one existing building as a white two-story hospital, adds a visual-only medical cross and minimap marker, and relocates two existing supplemental medical records to its reachable ground floor without increasing building or loot counts. The player camera applies scope FOV only while a sniper is active and the right mouse button is held or touch ADS is toggled.

Optional GLB models are loaded asynchronously and instantiated as non-pickable visual children. Procedural models remain the fallback. Repeated loot drops reuse inactive state IDs and marker meshes, and scene disposal clears marker references and imported containers.

The enemy character palette uses a dark blue-gray uniform while preserving authored skin colors; remote human characters retain their green palette. Procedural third-person weapons are created under each imported character LOD's `weapon_socket`, so reverting the weapon style does not reintroduce the old character coordinate system. Dynamic GLTF loader chunks receive two bounded reload retries across deployment cache mismatches before character fallback is accepted.

`IslandScene` receives an explicit local actor ID for multiplayer. Only that actor uses the first-person hitbox representation; remote human actors use the same third-person presentation contract as AI while retaining `kind: "player"` in authoritative state.

Multi-story buildings use deterministic two-lane switchback ramps with authoritative cross-lane landings. Movement, combat, and navigation consume the same ramp/floor geometry, including paths that begin midway along a ramp. Decorative brand signs resolve deterministic clear positions near selected POIs but remain non-pickable, non-colliding presentation meshes. The menu's responsive ABOUT field manual exposes creator, repository, gameplay, desktop controls, and mobile controls without changing session state.

## Multiplayer Services

`LobbyDirectory` owns temporary guest sessions, public room summaries, quick matching, and private room-code lookup. Every room has a separate `GameRoom` service that owns lobby readiness, WebSockets, actor assignment, checkpoints, and one `MatchRuntime`.

The directory classes extend the platform-neutral `DurableService` base and consume narrow storage, namespace, alarm, task, and socket interfaces. Cloudflare supplies those capabilities through Durable Object state. `standalone/LocalDurableObjectRuntime.ts` supplies the same contracts with one Node.js process, local SQLite key/value and SQL tables, local timers, and `ws` sockets. The gateway, room transitions, admission/reconnect rotation, account rules, administrator rules, protocol parsing, and authoritative match runtime are therefore shared rather than copied. `SERVER_PLATFORM` only selects platform-specific origin defaults; clients do not branch on the backend type.

`AccountDirectory` uses the platform SQL store for persistent player accounts: Durable Object SQLite on Cloudflare and the standalone database on Node. It implements case-insensitive unique usernames, native WebCrypto PBKDF2-SHA-256 password records at 100,000 iterations, opaque access/refresh sessions, refresh rotation, logout, account lookup, password changes, disabling, and session revocation. Public auth routes expose only short-lived access tokens; refresh tokens remain in `Secure`, `HttpOnly`, `SameSite=Strict`, host-only cookies.

`AdminDirectory` owns one administrator identity, eight-hour opaque Cookie sessions, and the global multiplayer admission policy. The shared gateway serves a same-origin `/admin` terminal. Bootstrap and forgotten-password recovery use separate deployment secrets; every mutation requires same-origin requests, and internal account/room operations require a separate in-process/generated or Worker capability. Optional Turnstile validation becomes fail-closed only when both the site and secret keys are configured.

When registration/login is required, the gateway validates the player access token before creating a guest-compatible room identity. That identity retains the account ID and session revision; Lobby and GameRoom revalidate linked accounts so disabling or revoking an account invalidates matchmaking, admissions, reconnects, and active sockets. Toggling the global policy does not interrupt pre-existing unlinked guest rooms.

`MatchRuntime` reuses `GameSimulation`, `BattleRoyaleMode`, `SimulationCombatWorld`, and `BotController`. Matches contain 2–10 stable human actors and enough bots to total 50. AI decisions are distributed across three deterministic cohorts while movement and all authoritative systems remain 30 Hz. Disconnected humans receive idle input, then server-side bot takeover without changing actor identity.

`CommandInbox` rejects stale sequences, expires continuous input, and consumes jump, interact, reload, switching, item use, and drops only once. The client predicts only local movement and replays unacknowledged inputs after each server correction; combat, inventory, healing, damage, loot, safe zones, and results are never predicted.

`MultiplayerSession` keeps authoritative and presentation state separate during reconciliation. A snapshot replaces the authoritative state, then unacknowledged local movement inputs are replayed. Corrections up to 6m are hidden only by a temporary camera/visual offset that decays to zero; the offset never mutates `MatchState`, commands, hit tests, pickup distance, or server acknowledgement state. Full resync, death, deployment changes, and larger grounded corrections snap immediately.

Remote positions use per-actor transitions starting from the position that was actually rendered before the snapshot. Old transitions advance before queued messages are consumed, so a long render frame that occurred before snapshot receipt cannot instantly complete the new transition. Duration follows the authoritative tick gap and is clamped to 120–250ms. Newly visible actors, alive/deployment changes, missing previous state, and impossible authoritative movement snap immediately. Grounded actors have a 6m smoothing ceiling. Parachuting actors use a dynamic ceiling derived from the real tick gap and the authoritative maximum glide/descent speed, with an 18m hard cap, so valid high-speed gliding stays smooth without disguising teleports.

`GameRoom` still advances rules at 30 Hz and considers a snapshot every third tick. An 80ms monotonic minimum interval suppresses back-to-back frames while the scheduler catches up after a stall; normal cadence remains approximately 10 Hz. `MatchRuntime.takeFrame()` is called only for frames that are actually sent, so sequenced events and dirty loot accumulate until the next frame. Match completion always forces a final frame even when the throttle suppressed that tick's regular candidate.

Standalone stores guests, room metadata, admissions, reconnect credentials, account/admin data, deadlines, and checkpoints in one WAL-mode SQLite database. A separate SQLite exclusive lock automatically releases its OS lock on process death and prevents two live Node processes from advancing the same data directory. Alarm rows remain durable until their handler completes and use generations so a reschedule cannot be deleted by the preceding invocation. On startup, persisted alarm records instantiate their services; running rooms rebuild `MatchRuntime` from the newest compatible, versioned checkpoint and immediately resume. A room whose checkpoint predates the current authoritative map semantics is closed and deleted instead of mixing old actor/loot positions with new collision geometry. Dormant room services are evicted after their persistent state, alarm, and sockets are gone, so completed matches do not accumulate in memory.

Reconnect rotation is two-phase: the previous token remains valid while a replacement is pending, and `connection.ack` promotes only the token issued to that connection. Losing the socket before `welcome` or its acknowledgement therefore cannot strand a client. Graceful SIGINT/SIGTERM stops room loops and writes an early checkpoint before bounded network draining, then writes again after sockets settle; the current checkpoint contract can still lose at most the interval since the last crash-safe write after an ungraceful kill and does not promise bit-for-bit restoration of transient Bot/controller memory.

## Performance Strategy

- Fixed 30 Hz rules with decoupled rendering
- Staggered AI decisions based on distance
- Bounded multi-wall path search with per-Bot path reuse
- Shared materials and hardware instances for static trees, shrubs, and decorative rocks; reusable loot records keep individually mutable meshes
- Low/medium/high quality profiles keep all 384 authoritative trees at identical seeded positions and vary only foliage tessellation, decorative-rock/shrub density, hardware scaling, and 60/90/120 FPS ceilings. Low quality keeps procedural characters without downloading GLBs; medium/high load character GLBs on demand and use distance-based character LOD. Held weapons remain procedural at every quality level.
- HUD state-heavy work runs at 10 Hz while scope, pause, orientation, and touch-control feedback remain render-frame responsive; leaderboard DOM rebuilds only when rank fields change
- Safe-zone geometry reuses one updatable position buffer instead of reallocating vertex/normal arrays during shrinking
- No dynamic shadows or full rigid-body simulation
- Dynamic GLTF loader chunk only when a manifest entry uses GLB
- Active multiplayer rooms use one single-threaded room authority—one Durable Object or one standalone in-process service—with 30 Hz rules, 10 Hz snapshots, and one-second checkpoints
- Multiplayer snapshot smoothing is presentation-only; authoritative movement, combat, inventory, safe-zone, and result state are never interpolated or rewound
- Cloudflare sockets may hibernate through the Durable Object API; standalone sockets remain in the single Node process and recover through reconnect after a restart

## Boundaries

Single-player never opens a network connection and pauses when desktop pointer lock or touch input is inactive. Multiplayer is server-authoritative and continues while a touch client is paused, hidden, or portrait-oriented; that client settles to idle input. Mobile gameplay requires landscape orientation. Fullscreen and orientation lock are best-effort browser capabilities and always retain a manual fallback. Standalone deployment is intentionally limited to one server and one Node process; running several processes against one database is rejected rather than risking duplicate room authorities. There are no social features, rankings, server-side lag-compensated hit rewind, or speculative future 5v5 rules.
