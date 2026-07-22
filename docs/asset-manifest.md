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
    "requiredNodes": "root,weapon_socket"
  }
}
```

Required fields:

- `id`: stable unique resource ID
- `type`: `svg`, `image`, `model`, or `procedural-model`

URL-backed entries also require `url`. Replaceable entries should define a type-compatible `fallback`.

## Supported Formats

- UI: SVG, PNG, WebP
- Environment textures, POI decals, and equirectangular skies: WebP
- Models: binary GLB
- Fallback models: procedural geometry described by metadata

## Loading and Fallback

The catalog preloads URL-backed assets and caches bytes. It validates manifest shape, duplicate IDs, fallback existence, fallback type, SVG structure, and browser image decoding.

GLB loading additionally requires at least one renderable mesh. If `requiredNodes` is present, every comma-separated node must exist. A network, decode, mesh, or node failure logs the resource ID and keeps the procedural fallback.

## Gameplay Isolation

GLB metadata may adjust visual scale and offset only. Imported meshes are non-pickable. Authoritative hit capsules, line of sight, damage, fire rate, magazine size, and inventory behavior are defined by the rule layer and cannot be changed through the manifest.

## Replacement Procedure

1. Add the file under `public/assets/`.
2. Change only the corresponding manifest entry from a procedural model or old URL to the new URL.
3. Add `requiredNodes` when the model contract needs named attachment points.
4. Run `npm run typecheck`, `npm run test`, and `npm run build`.
5. Open `npm run preview` in local Chrome/Edge with volume `0` and verify scale, offset, and fallback behavior.
