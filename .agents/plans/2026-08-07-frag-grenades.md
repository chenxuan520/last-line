# Authoritative Frag Grenades

## Goal

Add one supported throwable type, the fragmentation grenade, across single-player and authoritative multiplayer without changing the existing weapon, ammunition, equipment, or medical loot distribution.

## Acceptance

- Both maps deterministically add exactly 10 supplemental grenade loot points after the existing 240 base and 10 supplemental medical points; every grenade point contains exactly 2 frag grenades.
- Existing base loot and supplemental medical positions, item categories, quantities, ordering, and seeded distribution remain unchanged.
- Frag grenades occupy backpack stacks rather than either weapon slot. Picking up, dropping, death drops, throwing, and stack limits use the existing authoritative inventory path.
- Desktop players select grenades with `3`, hold primary fire to preview/aim, release to throw, use secondary fire to toggle high/low throw, and cancel by selecting a weapon. Touch players use a dedicated grenade action and the existing right-side drag-to-aim interaction.
- Throw preparation is presentation/input state only. A grenade is consumed only after the authoritative simulation accepts a one-shot throw command.
- Active grenades are JSON-serializable authoritative match state with stable IDs. Fixed-step flight, terrain/authoritative-geometry collision, bounce, fuse, explosion, radial falloff damage, and obstruction checks do not depend on Babylon meshes.
- Simultaneous grenade damage remains independent of command insertion order and actor kind. Self-damage is allowed; armor/helmet behavior follows the reviewed grenade damage contract.
- Multiplayer clients may preview the local trajectory, but grenade creation, inventory consumption, flight, explosion, damage, death, and resulting loot remain server-authoritative. Worker and standalone share the same protocol and match runtime.
- Bots use the same inventory and throw command as humans. They consider grenades only on staggered tactical updates, use visible or bounded remembered target positions, test a bounded number of trajectories, preserve human-like error, and avoid obviously unsafe throws.
- Grenade meshes, trajectory markers, explosion effects, and sounds are bounded/reused presentation resources. Automated and browser verification keeps volume at `0`.
- The user-provided grenade image is consumed through a stable asset ID after it appears on the updated main branch; no generated substitute asset is introduced.
- README, architecture, asset documentation, controls help, and repository agent guidance are updated where the long-term contract changes.
- Required focused tests, full validation, local production-build browser verification, independent reviewer/re-review, implementation commit, GitHub pull request, and `@codex` review loop complete with no unresolved blocker, high, or medium findings.

## Implementation

- Re-fetch and rebase onto `origin/main` before implementation integration and again immediately before the implementation commit. Confirm the supplied grenade image and wire it through the existing asset manifest/catalog.
- Extend map layout generation with a separate deterministic supplemental grenade-point set. Preserve all pre-existing random streams and append-only loot ordering so prior seeded layouts remain stable.
- Add throwable item/config/state/event types and a dedicated authoritative throwable system. Keep `GameMode` generic and keep all physics/collision/damage rules under `src/game/`.
- Extend `SimulationCombatWorld` with explicit throwable sweep and explosion-occlusion queries rather than treating presentation meshes as collision or overloading hitscan behavior.
- Extend `ActorCommand`, protocol sanitization, command inbox one-shot handling, checkpoint validation, snapshots, visibility filtering, and multiplayer presentation for authoritative grenades.
- Add desktop/touch selection, hold/release/cancel semantics, trajectory preview, inventory/HUD counts, stable asset rendering, pooled active-grenade presentation, and bounded explosion effects.
- Add bounded bot grenade selection and aiming through `BotController`; controllers produce commands only and never mutate state.
- Add deterministic unit tests for supplemental point invariants, inventory semantics, trajectory/collision/fuse/explosion/occlusion, simultaneous ordering, command sanitization/inbox behavior, bot safety/knowledge bounds, multiplayer snapshot/checkpoint persistence, scene lifecycle, and resource bounds.

## Build

- Rebased the implementation worktree onto `origin/main@a17dffa`, which contains the user-supplied `public/assets/ui/item-grenade.webp`; the implementation consumes the existing `ui.item.grenade` stable asset ID and does not add a substitute image.
- Both map families preserve the pre-existing 240 base and 10 supplemental medical points, then append 10 deterministic grenade points with `grenade.frag ×2`. Legacy island payload hashes remain unchanged when the append-only grenade fields are excluded, and Greyfurnace grenade points use distinct reachable ground-floor buildings.
- Added authoritative JSON state, one-shot commands, fixed 30Hz-substep flight, finite sphere sweeps, bounce damping, a 3.5s fuse, 8m obstructed radial falloff, self-damage, blast-origin feedback, deterministic sub-tick phases, death drops, protocol v7 snapshots, checkpoint v6 restoration, and shared Worker/standalone room validation.
- Added desktop `3` selection, high/low throw switching, hold-preview/release-throw, weapon cancellation, touch grenade count and drag-to-aim, cancellation-safe pointer handling, a procedural first-person grenade, bounded 20-grenade/24-trajectory presentation pools, four explosion meshes, bounded explosion voices, and the supplied HUD/backpack image.
- Bots use visible targets only, human-like landing error, a bounded high-arc solve, self-distance/error checks, staggered evaluation, 12–20s cooldowns, and one authoritative six-active-AI-grenade budget shared by regular Bots and disconnected-human takeovers. AI provenance is persisted on active grenades so reconnects cannot bypass the cap.
- Full Node.js 24 `npm run typecheck` passes, including application, Worker/test, and standalone projects.
- Reviewer-focused unit validation passes 147/147 after the final restoration, takeover-AI, cancellation, ramp-sweep, and mixed damage-phase fixes. Earlier focused suites also passed authoritative grenade rules, map append invariants, Greyfurnace reachability, input, protocol/inbox, checkpoint, scene lifecycle, asset decode, and bounded presentation checks.
- `npm run test:server` passes 25/25 real standalone integration tests, including HTTP/WebSocket flow, restart/persistence, process locking, room eviction, alarm generations, graceful shutdown, and same-version corrupt-checkpoint/member deletion.
- Full unit runs reached 432/434 functional assertions; the only two failures were pre-existing map wall-clock timeouts under host-wide 64-core saturation. A read-only `origin/main` benchmark exceeded the same 5s threshold on this host, while the affected map assertions pass individually/with bounded command-level timeouts. Repository timeout gates were not weakened.
- Worker runtime tests could not start because the host is Debian glibc 2.28 while the checked-in `workerd` binary requires GLIBC 2.29–2.35. Worker test TypeScript compilation passes, Worker same-version corruption tests are checked in, and `npm run build:worker` produces a successful Wrangler dry-run bundle. Docker/Podman is unavailable on the host, so no newer-glibc container fallback was possible.
- `npm run build`, `npm run build:server`, `npm run build:worker`, and final `npm run build:standalone` complete. Final `npm run check:budgets` passes: browser entry `1,095,394 / 1,100,000`, largest non-entry `613,551 / 650,000`, all browser JS `3,792,049 / 3,900,000`, chunks `252 / 260`, CSS `45,161 / 46,000`, entire dist `4,366,975 / 4,450,000`, Worker `493,051 / 500,000`, standalone `510,265 / 515,000`.
- With the user's explicit allowance for at most 20% budget growth, only the four exceeded raw-artifact thresholds changed: browser entry `1,075,000 → 1,100,000` (+2.3%), CSS `45,000 → 46,000` (+2.2%), Worker `460,000 → 500,000` (+8.7%), and standalone `480,000 → 515,000` (+7.3%). Aggregate JS, chunk count, largest non-entry, and entire-dist budgets remain unchanged.
- Local Chrome production-build verification ran with volume `0`: the grenade WebP decoded at 256×256, ABOUT and in-match controls exposed desktop/mobile grenade instructions, the single-player HUD loaded, and no application console errors occurred. Only expected software-WebGL warnings were present. The verification page/context and preview server were closed immediately; only `about:blank` remained and port 8797 was clear.

## Review

- Round 1 independent static review found one high and four medium issues: incomplete v6 checkpoint/room restoration validation, implicit mixed damage-phase ordering, a racy controller-only Bot grenade limit, touch cancellation throwing grenades, and point-ray ramp collision. All were verified and resolved through complete checkpoint/member validation plus Worker/standalone deletion coverage, an explicit shots → grenades → zone contract with mixed-phase tests, a deterministic authoritative AI grenade cap, separate touch cancel semantics, and finite-rectangle sphere sweep with indexed/full-scan parity.
- Round 2 independent static re-review confirmed the round-1 high and three medium fixes, then found two remaining medium issues: impossible `ready`/safe-zone-stage checkpoints could still restore, and player-kind takeover AI could bypass the cap. Restoration now accepts only recoverable flight/combat/consistent-finished states with a production-range safe-zone stage; AI command provenance is passed into the authoritative simulation and persisted on active grenades. Unit, standalone, and typed Worker corruption/takeover cases cover both fixes.
- Round 3 independent static re-review inspected the final diff rebased onto `origin/main@a17dffa` with read-only `git diff`/source commands and reported no remaining blocker, high, or medium findings. Its only non-blocking note was that the exact invalid-stage deletion case runs in shared-validator unit and standalone coverage rather than the local Worker runtime, whose tests remain blocked by host glibc.
