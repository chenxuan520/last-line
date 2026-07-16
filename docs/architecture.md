# Architecture

## Runtime Flow

`GameApp` loads the asset catalog, restores settings, renders the menu, and creates a `BattleRoyaleSession`. The session owns the Babylon scene, HUD, controllers, fixed-step clock, and `GameSimulation`.

Each fixed step follows this order:

1. Controllers produce `ActorCommand` values.
2. Movement commands update authoritative positions and deployment state.
3. Inventory actions resolve with tick-rotated conflict ordering.
4. Combat intents are collected and damage is settled as a batch.
5. `BattleRoyaleMode` advances flight, safe zones, zone damage, and results.
6. Dead inventories become reusable ground-loot records.
7. Rendering synchronizes from the resulting state.

## Authoritative Rules

`src/game/` has no DOM or Babylon dependency. `MatchState` contains serializable actors, inventories, ground loot, flight, safe zone, phase, and result data.

`SimulationCombatWorld` performs hitscan and line-of-sight tests against fixed actor capsules and static map obstacles. Babylon meshes only present the state and never decide a hit.

Simultaneous lethal damage uses a deterministic tick-based selector. The selected survivor still receives normal damage, armor reduction, and events, with health clamped to 1 only when every remaining actor would otherwise die in the same tick.

## Controllers

`HumanController` maps keyboard and mouse state to `ActorCommand`.

Each `BotController` has independent decision timers and memory. Bots use the same commands and systems as the player for movement, looting, firing, reloading, switching weapons, and healing.

## Rendering

`IslandScene` builds the 800m island, POIs, static collision geometry, procedural actors, loot markers, safe-zone ring, and first-person view weapon.

Optional GLB models are loaded asynchronously and instantiated as non-pickable visual children. Procedural models remain the fallback. Repeated loot drops reuse inactive state IDs and marker meshes, and scene disposal clears marker references and imported containers.

## Performance Strategy

- Fixed 30 Hz rules with decoupled rendering
- Staggered AI decisions based on distance
- Shared procedural materials and cloned loot/tree meshes
- Quality-dependent hardware scaling
- No dynamic shadows or full rigid-body simulation
- Dynamic GLTF loader chunk only when a manifest entry uses GLB

## Future Boundaries

The current state and command contracts can be moved toward an authoritative server, but networking, prediction, reconciliation, anti-cheat, matchmaking, and 5v5 rules are intentionally not implemented.
