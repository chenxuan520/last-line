# Generated Map Texture Integration

## Context

`main@4ed3f37` adds and manifest-registers fourteen generated 256×256 WebP textures for urban ground, rural soil, forest floor, damaged asphalt, building walls, and roof surfaces. The assets are not consumed by the renderer yet. This follow-up cycle integrates them into the architectural-variety branch without changing authoritative map facts.

The implementation continues on `feat/building-architectural-variety` after committed architecture baseline `8c71a80`.

## Contract

- Merge `origin/main@4ed3f37` without rewriting the public branch.
- Consume all newly registered textures through stable asset IDs; gameplay/render code must never reference concrete asset paths.
- Preserve map geometry, building placement/profile selection, roads, region ownership, loot, AI, protocol 10, checkpoint 9, Worker/standalone semantics, and every authoritative collision fact.
- Greyfurnace uses urban concrete and damaged asphalt ground treatment, aged concrete/brick industrial facades, and flat membrane or rusted metal roofs.
- Cinder Mist County derives presentation from the same seeded mixed-region ownership:
  - town: urban concrete/damaged asphalt plus aged concrete/brick facades and industrial roofs;
  - rural: dry soil, sparse-grass mud, and gravel plus aged plaster/brick facades and restrained gray/red-brown roof treatment;
  - forest: humus and wet moss plus weathered plaster/aged concrete cabins and dark gray roof treatment.
- The island uses gravel/dry-soil natural breakup, aged plaster/brick/concrete facade variation, and flat membrane/gray/red-brown roof variation.
- Hospital remains visually white and the ammunition depot retains its dedicated dark industrial material/sign. Neither may inherit random ordinary-building wall or roof textures.
- Texture selection is deterministic from stable map/building facts and independent of quality. Low/medium/high may vary existing detail density, but the selected base wall/roof/ground family must not change.
- Missing, failed, or invalid payloads retain readable procedural-color fallback. No cross-type UI image may become a world texture.
- Reuse materials and textures by semantic role/profile; do not create one material or texture per building. Keep scene-resource, JavaScript, chunk, CSS, Worker, and server budgets unchanged; the user-approved generated-image allowance may raise only the raw browser `dist/` ceiling.
- Production Chrome/Edge MCP verification must use volume `0`. The implementation agent must capture and personally inspect island, Greyfurnace, and Cinder Mist County screenshots, including adjacent wall/roof/ground transitions, tiling scale, brightness, clipping, overlap, and fallback readability. Every round must clean pages and preview servers immediately.

## Plan

1. Add focused failing renderer tests for generated asset consumption, deterministic wall/roof assignment, mixed-region ground ownership, hospital/depot isolation, fallback behavior, and bounded material/texture counts.
2. Merge `origin/main@4ed3f37` with `--no-commit` so the asset import and renderer integration land in one associated implementation commit.
3. Extend terrain material classification and batching so semantic region surfaces select the generated ground assets without altering terrain height or authoritative roads.
4. Extend building wall/roof presentation so deterministic architecture/building roles select the new facade and roof assets while retaining shared authoritative geometry and bounded batches.
5. Update architecture/asset documentation for the stable texture-role mapping; keep README free of generator internals.
6. Run focused tests, three-target typecheck, complete required suites, browser/Worker/server/standalone builds, budgets, and `git diff --check`; do not run coverage.
7. Perform production MCP screenshot inspection for all three maps at volume `0`, fix every visible defect, and clean MCP/preview resources after each round.
8. Launch one independent reviewer, resolve every blocker/high/medium finding, and request re-review.
9. Finalize this plan's Build/Review facts before the implementation merge commit, then push the existing PR branch, request fresh `@codex review`, and monitor CI/Cloudflare/Codex without editing the repository after commit.

## Build

- 2026-08-09: Inspected `origin/main@4ed3f37`. It adds fourteen 256×256 generated WebP files and stable manifest IDs, removes the obsolete standalone `metal.webp`, redirects legacy `texture.industrial.metal` to `roof.webp`, and adds manifest declaration tests. No renderer consumes the new IDs yet.
- 2026-08-09: Mapped all new assets to Greyfurnace, island, and mixed town/rural/forest presentation roles. The integration is explicitly presentation-only; protocol 10 and checkpoint 9 remain unchanged.
- 2026-08-09: Integrated all fourteen generated textures through stable asset IDs. Terrain uses one shared ground mesh with bounded `MultiMaterial` submeshes; walls and roofs use deterministic map/region families with shared materials. Hospital surfaces remain untextured white, and the ammunition depot retains its dedicated `texture.industrial.metal` surface.
- 2026-08-09: Added direct integration coverage for island, Greyfurnace, and mixed town/rural/forest ground, wall, roof, hospital/depot isolation, payload-free fallbacks, material/texture limits, and concrete coordinate sampling for mixed-region natural, mud, road-shoulder, and road-core roles.
- 2026-08-09: Node 24 validation passed: full typecheck; complete unit suite `50 files / 562 tests`; standalone suite `3 files / 33 tests`; browser, Worker dry-run, server, and standalone builds; `git diff --check`; and deterministic budgets. Final artifacts used `1,148,852 / 1,200,000` browser-entry bytes, `3,831,623 / 4,000,000` total JavaScript bytes, `4,654,788 / 4,700,000` raw `dist/` bytes, `576,139 / 615,000` Worker bytes, and `589,411 / 630,000` standalone-server bytes.
- 2026-08-09: Local Worker runtime tests could not start because this Debian host has glibc 2.28 while the installed `workerd` requires GLIBC 2.29 through 2.35. Worker typecheck and dry-run bundling passed; the runtime suite remains for the Node 24 CI runner.
- 2026-08-09: Production Chrome MCP verification ran at volume `0` for all three maps. The first mixed-map pass exposed a coarse rural texture checkerboard; replacing it with continuous dry soil plus region-aware gravel/urban-concrete shoulders removed the artifact. Follow-up screenshots confirmed readable wall/roof tiling, continuous town roads and shoulders, mixed forest/rural transitions, no missing ground, no clipping/overlap, and no console error. Every round returned Chrome to `about:blank`, stopped preview, removed screenshots, and released port 4173.

## Review

### Independent review round 1 — 2026-08-09

- Scope: static review of the complete pending merge commit against this plan, `origin/main@4ed3f37936125d966735863cf0f3bde8fd504eaa`, and the previously reviewed architectural baseline `8c71a80e237ad48534e79a4fb9065049bfb568c1`. The review focused on the uncommitted texture integration, tests, documentation, and budget adjustment rather than re-reviewing the committed building-shape work.
- Existing evidence accepted without rerunning: Node 24 typecheck; 562 source unit tests; 33 standalone tests; Worker typecheck and dry-run build; browser, Worker, server, and standalone builds; deterministic budget checks; two production Chrome MCP visual rounds at volume `0`, including the corrected mixed-rural ground transition and immediate browser/preview cleanup. The local Worker runtime gap remains the recorded old-glibc inability to launch `workerd`, not an integration failure.
- Conclusion: **not approved; one medium finding must be fixed and re-reviewed.** No blocker or high finding was identified.
- **Medium — mixed-region road shoulders ignore their owning region** (`src/client/render/scenes/IslandScene.ts:1462`): `terrainTextureAssetId` returns gravel for every mixed-map `road-shoulder` before resolving the nearest seeded region. This makes town shoulders use the rural gravel family, despite the contract requiring mixed town presentation to use the Greyfurnace urban-concrete/damaged-asphalt family; it also means the result is not fully derived from the same mixed-region ownership used for natural terrain. Resolve the mixed region before selecting its shoulder treatment (while retaining the visually accepted rural dry-soil body plus gravel shoulder), and add a focused assertion that samples town/rural/forest coordinates rather than only checking the scene-wide set of texture names.
- **Low — plan wording must reflect the reviewed artifact-budget decision** (`.agents/plans/2026-08-09-generated-map-texture-integration.md:23`): the contract still says artifact budgets remain unchanged, while the implementation raises only `browserDist` from 4.55 MB to 4.70 MB. The user explicitly authorized a larger static-asset allowance, and the net generated-image addition exceeds the old ceiling, so the code/config change itself is accepted as an explicit reviewed budget decision; align the plan wording before the implementation commit. The JavaScript, chunk-count, CSS, Worker, and server ceilings remain unchanged.
- Static checks otherwise found the fourteen stable asset IDs actually connected to terrain/wall/roof materials, bounded shared material families, valid MultiMaterial/submesh construction, explicit hospital/depot isolation, payload-free procedural fallback, quality-independent selection, no concrete asset paths in renderer code, and no protocol/checkpoint changes beyond the already committed baseline values 10/9.

### Independent review round 2 — 2026-08-09

- Scope: static re-review of the round-1 Medium and Low fixes and their adjacent terrain-selection/test paths. The outer agent's post-fix Node 24 app typecheck, focused 5-test integration run, production build, and production Chrome MCP screenshot/console/cleanup evidence were accepted without rerunning.
- **Round-1 Medium closed:** `terrainTextureAssetId` preserves damaged asphalt as the highest-priority road-core result, handles standalone town/island semantics, then resolves mixed nearest-region ownership before selecting road shoulders. Mixed town shoulders now use urban concrete while rural and forest shoulders use gravel. The exported pure selector calls the same production function, and the focused seed-0 assertions cover town/rural/forest natural, mud, shoulder, and road roles rather than merely checking a scene-wide texture set.
- **Round-1 Low closed:** the contract now records the user-approved exception only for the raw browser `dist/` ceiling while retaining the scene-resource, JavaScript, chunk, CSS, Worker, and server limits.
- Conclusion: **approved. No blocker, high, or medium findings remain, and the fixes introduced no new blocker/high/medium issue.**
- Residual note: Worker runtime tests remain unavailable on this host because its old glibc cannot start `workerd`; the previously recorded Worker typecheck/dry-run evidence and the presentation-only scope remain the available coverage for that environment gap.
