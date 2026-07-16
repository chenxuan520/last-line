# Project Agent Guide

## Goal

Maintain a desktop browser battle royale with one human player and 19 AI actors. Preserve the complete aircraft-to-result loop and the boundary between authoritative rules and client presentation.

## Commands

```bash
npm ci
npm run typecheck
npm run test
npm run build
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

## Completion Checklist

1. Run `npm run typecheck`.
2. Run `npm run test`.
3. Run `npm run build`.
4. If presentation changed, open the production build in local Chrome/Edge with volume `0` and check the console.
5. Update README or `docs/` when contracts, controls, commands, or architecture change.
