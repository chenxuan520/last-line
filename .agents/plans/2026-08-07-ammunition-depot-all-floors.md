# Ammunition Depot All-Floor Loot

## Context

PR #4 currently gives every ammunition depot a complete internal stairwell and authoritative access to every story, but the four depot-exclusive ammunition stacks are all placed on the ground floor. The active goal is to complete the ammunition depot across all interior floors.

This is a new follow-up implementation cycle on committed baseline `3312ec799d53ad88c90d9e457d8fbe258c0d1a84`. Previously committed plans remain read-only.

## Contract

- Every interior story of the selected ammunition-depot building contains one stack of each weapon ammunition:
  - `ammo.rifle × 90`
  - `ammo.light × 96`
  - `ammo.shell × 18`
  - `ammo.sniper × 16`
- Interior story levels are `0` through `storyCount - 1`. The roof level is not an indoor ammunition floor.
- One-story depots retain four stacks. A two-story depot has eight stacks, a three-story depot has twelve stacks, and a four-story depot has sixteen stacks.
- `AmmunitionDepotPoi` records explicit per-level loot indexes. Battle-royale initialization consumes those indexes rather than inferring array tails.
- The original 250 global loot records remain unchanged. Depot records begin at index 250 and are appended level-major, then in rifle/light/shell/sniper order.
- Every stack rests on the authoritative support for its level, remains inside the building, avoids the stairwell/ramp footprint, is standable, and is reachable from the ground-floor door through the same internal stairs used by Movement and GridNavigator.
- Single-player, Worker, and standalone derive the same map/seed-dependent initial loot count.
- Checkpoint version remains 7 and protocol remains 8 because this PR is not merged; their final unmerged contract is updated before release.
- Checkpoint restore requires all canonical initial loot keys for the checkpoint's explicit `mapId + mapSeed`, while continuing to allow valid additional dynamic drop/death records.
- Existing non-target map facts and the first 250 loot records remain identical to `main`.

## Plan

1. Add failing layout and battle-royale tests for one-, two-, three-, and four-story depots.
2. Replace the single four-index depot record with explicit per-level records.
3. Generate four clear points per interior level at the correct support height.
4. Initialize fixed ammunition records level-by-level.
5. Make checkpoint canonical-roster validation derive the required count from `createMapLayout(mapId, mapSeed)`.
6. Add unit and real standalone/Worker restore coverage for a missing last-floor canonical record; keep valid extra dynamic records accepted.
7. Re-run main zero-drift comparison for non-target fields and the first 250 points.
8. Run Node 24 typecheck, full unit/standalone tests, Worker dry-run, browser/server/standalone builds, budgets, and `git diff --check`; do not run coverage.
9. Verify one one-story, one two-story, and one three-story depot in production Chrome with volume 0, including per-floor loot heights and internal reachability evidence.
10. Run an independent reviewer before the follow-up commit, push to PR #4, rerun CI/Pages/Codex, and leave the PR open.

## Build

- 2026-08-07: Completion audit found the gap. Across representative seeds, depot buildings had one to three stories, but all explicit depot indexes pointed to ground-floor positions around level `0.11–0.23`; upper interior levels had no depot ammunition.
- 2026-08-07: Added explicit level-major `AmmunitionDepotLevel` records. Every interior story now appends rifle/light/shell/sniper indexes after the unchanged 250-record global prefix, and `BattleRoyaleMode` creates the four fixed stacks for every recorded level.
- 2026-08-07: Upper-story points use the shared authoritative floor support and ground-story points follow terrain. Nine island/town/mixed fixtures covering one-, two-, and three-story depots passed height, index, door-to-floor navigation, standability, and 3D pickup checks.
- 2026-08-07: Checkpoint compatibility now rebuilds the canonical initial loot count from the persisted `mapId + mapSeed`; it requires every canonical key and still permits valid dynamic records. Unit and real standalone SQLite tests use a three-story mixed depot and reject a checkpoint missing its final `loot-261` record. The equivalent Worker Durable Object regression is present and typechecks, but this host's glibc 2.28 cannot start the current workerd binary; GitHub's Node 24 Worker suite remains required evidence after push.
- 2026-08-07: A detached `3312ec7` comparison covered island/town/mixed across seeds `0, 1, 2, 4, 7, 19, 42, 99, 2026`: all non-depot-roster layout facts and `lootSpawnPoints[0..249]` were byte-for-byte JSON identical.
- 2026-08-07: Node 24 validation passed full unit `46 files / 472 tests`, full standalone `3 files / 26 tests`, three-target typecheck, browser build, Worker dry-run, server build, same-origin standalone build, budgets, and `git diff --check`. One parallel standalone run timed out an unchanged malformed-members test at 5.127 seconds; the complete suite passed unchanged with one worker. Coverage was not run.
- 2026-08-07: Production Chrome DevTools MCP verified one-, two-, and three-story island depots with volume `0`. The scenes exposed `4 / 8 / 12` enabled depot markers respectively; every upper level contained rifle/light/shell/sniper at its own support height, while the ground-floor markers followed terrain. The depot sign, dedicated surface batch, floor batch, and internal-ramp batch remained present. Console output contained only the local SwiftShader warning and all requested assets loaded successfully.
- 2026-08-07: Each browser round used a separate isolated context; immediately afterward its page and preview server were closed. Final cleanup left only page 1 `about:blank`, no listener on port 8798, no task preview process, and no temporary baseline worktree.

## Review

Pending implementation, validation, and independent review.

### 2026-08-07 Final Independent Review

- Scope: static review of the uncommitted follow-up diff on baseline `3312ec799d53ad88c90d9e457d8fbe258c0d1a84`, with the complete branch compared against `origin/main@feea36a`. Reviewed this plan, root `AGENTS.md`, `README.md`, architecture/deployment guidance, map generation, per-level loot indexing, `BattleRoyaleMode`, AI navigation and 3D pickup paths, checkpoint compatibility, Worker/standalone restore callers, and the affected tests.
- Conclusion: **not passed; commit remains blocked**.
- Findings: blocker 0, high 0, medium 1, low 0.

1. **Medium — The legal four-story mixed-map depot is outside the documented and tested contract, while direct BattleRoyale initialization tests do not even exercise the planned three-story boundary.**
   - Locations: `src/config/mixedMap.ts:38`, `src/config/mixedMap.ts:852`, `src/config/map.ts:1987`, `tests/unit/mapLayout.test.ts:140`, `tests/unit/battleRoyaleMode.test.ts:50`, `tests/unit/battleRoyaleMode.test.ts:133`, `docs/architecture.md:45`, and this plan's steps 1 and 3-story contract.
   - Mixed town buildings legitimately have `storyCount: 4`, and depot selection does not cap the selected preferred warehouse/factory. A read-only blueprint scan found 13 four-story depots in mixed seeds `0..127`; `createMapLayout("mixed", 5)` selects `mixed-building-0-30` with four interior levels, 266 canonical records, and final-floor indexes `loot-262..loot-265`.
   - The implementation currently loops over `building.storyCount`; the targeted seed-5 inspection found correct level-3 support and non-empty door-to-loot paths. This is therefore a missing contract/regression boundary, not proof that the current loop already fails at runtime.
   - The nine explicit layout fixtures stop at one/two/three stories. More importantly, the direct fixed-ammunition assertions in `battleRoyaleMode.test.ts` currently hit only a two-story depot for `() => 0.5`, while its seeded loot-order fixtures hit one-story depots. They do not verify rifle/light/shell/sniper item, quantity, order, and final index on either a three-story or the legal four-story depot. The three-story checkpoint tests prove that a generated valid roster contains `loot-261` and that deleting it is rejected, but they do not independently assert the last floor's four BattleRoyale item semantics.
   - `docs/architecture.md` enumerates only 254/258/262 canonical records and omits the real 266-record four-story case; the plan likewise describes the observed range as one through three. This can make future fixed-count validation regress to 262 even though mixed seed 5 requires `loot-265`.
   - Builder action: keep the all-interior-story behavior, add a deterministic four-story mixed layout/standability/navigation/3D-pickup fixture, add direct BattleRoyale initialization assertions that genuinely exercise the planned three-story case and the legal four-story final floor, and document the 266-record case. Re-run the affected targeted tests and request re-review. Do not constrain depot selection to three stories merely to satisfy the existing fixtures unless the product contract is explicitly changed and the resulting seeded depot identity/zero-drift impact is reviewed.

- No additional blocker/high/medium issue was found in the static implementation path. Per-level indexes are contiguous from 250 in level-major rifle/light/shell/sniper order; the nine reviewed 1/2/3-story fixtures rest on authoritative slabs/terrain and avoid the stair footprint; AI and pickup use 3D distance; Worker and standalone share `isMatchCheckpointCompatible`; valid extra loot remains accepted; and `mapId` plus uint32 `mapSeed` are checked before a bounded eight-entry map-layout cache is used, so no unbounded checkpoint-derived count/cache behavior was identified.
- Existing outer evidence was consumed without repeating full validation: unit 46/472, standalone 3/26, three-target typecheck, all builds, budgets, 27-layout baseline comparison, and volume-0 Chrome checks. Reviewer-only commands were limited to read-only fixture/seed inspection for the uncovered story-count and final-floor risks; no full test, build, budget, Worker runtime, or browser command was rerun.

### Final review finding disposition

- **Medium (legal four-story mixed depot and missing direct final-floor semantics) — resolved.**
  - Kept the all-story implementation and added mixed seed `5` as the deterministic four-story boundary. The layout contract now covers island/town one through three stories plus the legal mixed four-story depot, including level-major indexes through `loot-265`, support height, door-to-floor navigation, and total canonical count `266`.
  - Added direct `BattleRoyaleMode` initialization assertions for island seed `4` (three stories) and mixed seed `5` (four stories). Both verify the final floor's rifle/light/shell/sniper records, exact quantities, positions, stable IDs, source, availability, and dynamic total count.
  - Added a focused mixed seed `5` regression proving all four final-floor loot positions are navigable from the authoritative door and interactable through the normal 3D `InventorySystem` pickup path.
  - Updated `docs/architecture.md` to document the legal four-story / 266-record case without changing depot selection or any seeded layout facts.
  - Focused Node 24 verification passed: layout boundary `10 passed`, final-floor BattleRoyale initialization `2 passed`, fourth-floor navigation/pickup `1 passed`, app typecheck, and `git diff --check`. The initially started three-file command was stopped before completion because it would also rerun unrelated long 49-bot simulations; no result from that interrupted command is claimed.

### 2026-08-07 Round 2 Independent Review

- Scope: re-reviewed only the sole Medium finding from `Final Independent Review` and the incremental disposition diff in `tests/unit/mapLayout.test.ts`, `tests/unit/battleRoyaleMode.test.ts`, `tests/unit/aiLootReachability.test.ts`, `docs/architecture.md`, and this plan. No broader implementation area was reopened.
- Conclusion: **passed; the Medium finding is closed**.
- Findings: blocker 0, high 0, medium 0, low 0.
- The mixed seed `5` layout fixture fixes the legal four-story boundary at 266 canonical records, verifies contiguous level-major indexes through `loot-265`, authoritative support heights, and a non-empty ground-door path to every depot point.
- The island seed `4` and mixed seed `5` initialization fixtures directly verify the three- and four-story final floors' rifle/light/shell/sniper IDs, quantities, positions, stable loot IDs, generation, source, availability, and map-dependent total record count.
- The focused mixed seed `5` reachability fixture checks all four final-floor points from the authoritative door and exercises pickup through the normal `InventorySystem` interaction path with the actor positioned at the point's three-dimensional interaction height.
- `docs/architecture.md` now records 254/258/262/266 canonical initial records, and `Final review finding disposition` accurately describes the reviewed changes and evidence.
- Existing outer evidence was accepted without repetition: layout `10 passed`, BattleRoyale `2 passed`, AI pickup `1 passed`, Node 24 app typecheck, and `git diff --check`. This review ran no tests, builds, browser checks, or other validation commands.

## 2026-08-08 Minimap Visual Alignment Follow-up

### Context

The ammunition-depot minimap marker existed and used the correct icon/position, but its wrapper class was omitted from the shared POI label and fallback-circle CSS selectors. This is a visual defect in the ammunition-depot feature and remains in this plan rather than creating a separate plan.

### Contract

- The ammunition-depot minimap label must use exactly the same font family, size, weight, fill, letter spacing, text anchor, stroke, paint order, and vertical offset as ordinary POIs and the hospital.
- Its fallback circle must use the same fill, stroke, and stroke width as the other POI fallback markers.
- Its dedicated icon and authoritative position remain unchanged.
- Every visible feature change requires a production Chrome/Edge screenshot at volume `0`, visual inspection of the affected region, and explicit comparison against adjacent same-role elements before completion.

### Plan

1. Preserve a repair-before screenshot and computed-style comparison for ordinary POI, hospital, and ammunition-depot labels.
2. Add a focused failing stylesheet regression before editing CSS.
3. Add the ammunition-depot wrapper to the existing shared POI text and fallback-circle selectors without a special override.
4. Run focused unit tests, app typecheck, production build, budgets, and `git diff --check`; do not run coverage.
5. Open the production build at volume `0`, capture the minimap after repair, visually inspect font/color/size/alignment/overlap, and confirm computed styles exactly match the hospital and ordinary POIs.
6. Run an independent reviewer, resolve blocker/high/medium findings, commit/push this new repair cycle, then require latest-SHA CI, Pages, and Codex approval.

### Build

- 2026-08-08: Production screenshot `/tmp/last-line-minimap-before.png` showed the defect directly: the black default-size `弹药库` text covered the minimap center while all other labels used small outlined tactical text.
- 2026-08-08: Computed styles confirmed ordinary POI and hospital labels used `6.5px`, weight `700`, `rgb(220, 226, 215)`, centered text, tactical font, and stroke paint order. The ammunition-depot label incorrectly used `16px`, weight `400`, black fill, start alignment, Inter/system font, and normal paint order.
- 2026-08-08: Root `AGENTS.md` now requires every visible feature change to be inspected through an actual production screenshot and visually aligned with adjacent elements of the same role; DOM/tests/computed styles alone cannot substitute for screenshot review.
- 2026-08-08: After the shared font/color repair, the implementation agent personally opened `/tmp/last-line-minimap-island-after.png`; the island depot label matched the surrounding POIs and no longer covered the map center. Computed font, size, weight, fill, spacing, anchor, stroke, and paint order exactly matched ordinary POIs and the hospital.
- 2026-08-08: The required second screenshot check found a remaining Greyfurnace defect instead of accepting the CSS-only fix. In `/tmp/last-line-minimap-town-after.png`, the depot label used the correct visual style but sat too close to the dense upper-right labels. Browser bounding boxes confirmed `弹药库` overlapped `仓储港区`; deterministic label collision avoidance is therefore required before this repair can pass.
- 2026-08-08: Label layout was generalized to every named minimap marker instead of adding a depot-only offset. All POIs, the hospital, and the ammunition depot share the same visual style and deterministic candidate placement; labels avoid every other label and every 12px icon while staying inside the map frame.
- 2026-08-08: Focused stylesheet/minimap regressions passed `23/23`. A three-map scan covering `160` seeds per map (`480` layouts) verified every named label pair is disjoint, every label clears every icon, and every label remains inside the minimap frame. App typecheck, production build, budgets, and `git diff --check` passed; coverage was not run.
- 2026-08-08: The implementation agent personally opened the final MCP screenshots `/tmp/last-line-minimap-town-zero-overlap.png`, `/tmp/last-line-minimap-island42-zero-overlap.png`, and `/tmp/last-line-minimap-mixed-zero-overlap.png`. Greyfurnace's dense labels, island seed 42's near-coincident depot/warehouse markers, and the mixed map all rendered with consistent tactical font, size, weight, color, alignment, and visible icon spacing.
- 2026-08-08: Real browser bounding boxes confirmed zero label/label and zero label/icon intersections on all three final screenshots (`10/10`, `10/10`, and `8/8` labels/icons respectively), with volume `0`. Console output contained only the local SwiftShader warning. Each isolated context and preview server was closed immediately; final MCP state returned to the single unavoidable `about:blank` page with no port 8798 listener.
- 2026-08-08: Final Node 24 validation passed full unit `46 files / 483 tests`, full standalone `3 files / 26 tests`, three-target typecheck, production build, budgets, and `git diff --check`. A parallel standalone run exceeded unchanged 5-second limits in two SQLite restore tests under concurrent full-unit load (`5.232s / 5.280s`); the complete standalone suite passed unchanged with one worker. Coverage was not run.

### Review

Pending implementation, validation, and independent review.

#### 2026-08-08 Minimap Visual Alignment Independent Review

- Scope: static review of the uncommitted minimap visual-alignment diff on baseline `ed1624da3a86c6dc752579f43ea49edc8285b7e0`, with the complete feature branch also compared against `main`. Reviewed this follow-up contract and recorded evidence, root `AGENTS.md`, shared minimap CSS, deterministic label placement, the `GameHud` marker-to-SVG call chain, and focused regressions. No test, typecheck, build, budget, seed scan, or browser command was repeated.
- Conclusion: **passed; commit is not blocked**.
- Findings: blocker 0, high 0, medium 0, low 0.
- The ammunition-depot fallback circle and text now share the exact CSS declaration blocks used by ordinary POIs and the hospital, with no later selector overriding their font family, size, weight, fill, spacing, anchor, stroke, paint order, or marker colors.
- Every ordinary POI, the hospital, and the ammunition depot enters one stable layout sequence; the greedy candidate order is deterministic, all marker icons are blockers before label placement begins, accepted labels become blockers in sequence, and the selected offsets are wired directly to each rendered SVG `<text>` element through both `x` and `y`.
- The current width model is conservative for the controlled all-CJK marker names under the shared `6.5px` font, `0.04em` letter spacing, and `2px` centered stroke; the 9px vertical box likewise includes the font-size box plus stroke. The 12px icon blocker matches the rendered image dimensions, while fallback circles receive an intentionally larger conservative blocker.
- Candidate exhaustion falls back to the historical offset and therefore remains a residual consideration if future maps add substantially more markers, longer names, or different font metrics. It is not a current blocking defect: the recorded 480-layout scan covered every marker in each generated layout without exhausting placement, and the three production-browser boundary cases used actual rendered boxes with zero label/label and label/icon intersections.
- Focused tests cover every marker category in the shared layout input, pairwise label and icon clearance for island/town/mixed fixtures, stable visual assets, and the shared CSS selector regression. Static call-chain review plus the recorded production screenshots confirms the pure placement result is consumed by the actual HUD renderer.
- The new `AGENTS.md` rule is explicit that the implementation agent must capture and personally open a production MCP screenshot at volume `0`; it names the required visual comparisons and clearly rejects DOM, computed-style, unit-test, console, or second-agent reports as substitutes.
- Existing outer evidence was accepted as recorded: focused `23/23`, app typecheck, production build, budgets, `git diff --check`, the 480-layout scan, three personally inspected production screenshots, three real-browser zero-intersection checks, volume `0`, console review, and immediate MCP/preview cleanup.
