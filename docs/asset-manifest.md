# Asset Manifest Contract

The manifest is `public/assets/asset-manifest.json`. Gameplay and UI request stable IDs through `AssetCatalog`.

## Entry Shape

```json
{
  "id": "model.character.enemy",
  "type": "model",
  "url": "./assets/models/enemy.glb",
  "fallback": "fallback.model",
  "metadata": {
    "scale": 1,
    "offsetX": 0,
    "offsetY": -1.76,
    "offsetZ": 0,
    "requiredNodes": "root,weapon_socket,backpack_socket",
    "armorMeshes": "character-merged-armor",
    "helmetMeshes": "character-merged-helmet"
  }
}
```

Required fields:

- `id`: stable unique resource ID
- `type`: `svg`, `image`, `model`, or `procedural-model`

URL-backed entries also require `url`. Replaceable entries should define a type-compatible `fallback`.

## Supported Formats

- UI: SVG, PNG, WebP
- Environment textures, POI/brand decals, and equirectangular skies: WebP
- Models: binary GLB
- Fallback models: procedural geometry described by metadata

## Loading and Fallback

The catalog preloads URL-backed UI and image assets and caches bytes. Character GLBs are loaded and cached on demand when a medium/high-quality scene needs them; low quality keeps the procedural character fallback and does not download GLBs. First- and third-person held weapons always use the procedural models. The catalog validates manifest shape, duplicate IDs, fallback existence, fallback type, SVG structure, and browser image decoding.

GLB loading additionally requires at least one renderable mesh. If `requiredNodes` is present, every comma-separated node must exist. A network, decode, mesh, or node failure logs the resource ID and keeps the procedural fallback.

Character GLBs use `root,weapon_socket,backpack_socket`. Character entries must also declare exact comma-separated `armorMeshes` and `helmetMeshes` names so equipment visibility never depends on arbitrary mesh naming. These named meshes are validated as renderable during loading. Character base IDs have matching `.lod1` IDs, for example `model.character.enemy.lod1`. Optional `uniformDarkColor`, `uniformColor`, `uniformLightColor`, `armorColor`, `strapColor`, and `helmetColor` metadata recolors matching authored PBR materials without changing skin. The client selects character base/LOD1 groups by camera distance; this is presentation-only and never enters authoritative match state.

Remote human actors use `model.character.player`, bots use `model.character.enemy`, and the local first-person actor does not render a third-person body. Held weapons use the stable procedural `model.weapon.*` entries in both first and third person. A missing or invalid base character keeps the procedural body fallback at every distance; a missing character LOD1 only makes the valid base remain active at distance.

If a versioned deployment briefly serves HTML for a dynamically imported JavaScript chunk, the browser retries by reloading at most twice. After the retry budget is exhausted, normal model fallback remains available and gameplay is not blocked.

## Gameplay Isolation

GLB metadata may adjust visual scale and offset only. Imported meshes are non-pickable. Authoritative hit capsules, line of sight, damage, fire rate, magazine size, and inventory behavior are defined by the rule layer and cannot be changed through the manifest.

## Replacement Procedure

1. Add the file under `public/assets/`.
2. Change only the corresponding manifest entry from a procedural model or old URL to the new URL.
3. Add `requiredNodes` when the model contract needs named attachment points. Character model entries must also provide non-empty `armorMeshes` and `helmetMeshes` with exact renderable mesh names.
4. Run `npm run typecheck`, `npm run test`, and `npm run build`.
5. Open `npm run preview` in local Chrome/Edge with volume `0` and verify scale, offset, and fallback behavior.
