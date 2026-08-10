# Canonical Loot Checkpoint Guard

## Context

Codex reviewed commit `dae6572f290f9358e93879bdcc64511acf0de2b1` in PR #4 and identified a valid P2: checkpoint version 7 validates every present `groundLoot` entry but does not require the authoritative initial `loot-0` through `loot-253` roster. An empty or truncated record could therefore restore without the ammunition-depot stacks.

This is a new follow-up implementation cycle. The committed ammunition-depot plan is read-only.

## Plan

- Require every checkpoint to contain canonical keys `loot-0` through `loot-253`.
- Require every ground-loot record key to equal its stable `loot.id`.
- Continue allowing additional valid dynamic drop/death records.
- Cover empty loot, missing `loot-250`, key/ID mismatch, and valid extra records in unit tests.
- Cover missing `loot-250` deletion through real standalone SQLite and Worker Durable Object restore paths.
- Run Node 24 unit/standalone/typecheck, Worker dry-run, build/budget, and `git diff --check`; do not run coverage.
- Run an independent static reviewer before the follow-up commit.
- Push the follow-up commit to PR #4 and request a new Codex review.

## Build

- 2026-08-07: Unit red test reproduced the P2: `groundLoot: {}` was accepted by `isMatchCheckpointCompatible()`.
- 2026-08-07: Added a shared canonical roster guard requiring `loot-0..loot-253`, key/ID identity for every canonical and dynamic record, while permitting valid additional records.
- 2026-08-07: Added real standalone SQLite and Worker Durable Object truncated-loot restore regressions.
- 2026-08-07: Targeted unit and standalone tests passed. Typecheck initially exposed an imprecise boolean helper; `isRecoverableLoot()` was tightened to a `GroundLootState` type predicate without changing runtime behavior.
- 2026-08-07: Final validation passed: targeted canonical-roster unit and SQLite restore tests, full standalone 3 files / 26 tests, Node 24 three-target typecheck, Worker dry-run, server build, budgets, and `git diff --check`. The full unit run passed 462/463 with one pre-existing 5-second town natural-detail timeout under load; that exact test passed unchanged with one worker. Coverage and Chrome were not run because this follow-up changes only checkpoint restore validation.

## Review

Pending validation and independent review.

### 2026-08-07 Independent Follow-up Review

- Scope: static review of the uncommitted follow-up diff on committed baseline `dae6572`, covering `src/server/MatchRuntime.ts`, the unit/standalone/Worker regressions, and this plan. The committed branch delta against `origin/main` was used only as context; no unrelated follow-up changes were found.
- Contract: `TOTAL_LOOT_POINTS` is 254, and compatibility now requires own properties `loot-0` through `loot-253`. Every present canonical or additional record is shape-checked first and must have a record key equal to `loot.id`; valid additional dynamic drop/death records remain allowed because the guard imposes neither an exact record count nor an extra-key whitelist.
- Persistence coverage: both new restore tests start from a current valid `MatchRuntime.checkpoint()`, retain valid two-player member mappings, remove only `loot-250`, persist both room and checkpoint records, and verify deletion after a real standalone SQLite restart or Worker Durable Object eviction/reconstruction. No earlier version, actor, member, map, or state-shape guard explains those deletions.
- Evidence considered without repetition: red reproduction for accepted empty `groundLoot`; passing targeted unit/SQLite tests, standalone 3 files / 26 tests, Node 24 typecheck, Worker dry-run, server build, budgets, and diff check. The full unit run passed 462/463 with one pre-existing five-second town-detail timeout whose unchanged test passed alone; coverage and Chrome were appropriately omitted for this restore-validation-only follow-up.
- Conclusion: **passed**. Findings: blocker 0, high 0, medium 0, low 0. No unresolved issue blocks the follow-up commit.
