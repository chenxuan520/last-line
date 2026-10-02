// 极高的表现预算与配色，不能用于权威地形或碰撞。
export const ULTRA_PRESENTATION = {
  fogStart: 1_400,
  fogEnd: 3_600,
  staticShadowSize: 2_048,
  staticShadowSpan: 256,
  actorShadowSize: 1_024,
  actorShadowSpan: 96,
  actorShadowDistance: 40,
  roadMaskSize: 2_048,
  roadTextureMeters: 6,
  foliageLodDistance: 100,
  detailBatchSpan: 128,
  detailLodDistance: 320,
  lootFillIntensity: 0.22,
  lootFillMinimum: 0.16,
} as const;

export const ULTRA_TERRAIN_TINTS: Readonly<Record<string, readonly [number, number, number]>> = {
  "texture.terrain.concrete-urban": [0.84, 0.84, 0.81],
  "texture.terrain.dry-soil": [0.84, 0.81, 0.73],
  "texture.terrain.forest-humus": [0.77, 0.80, 0.70],
  "texture.terrain.forest-moss-wet": [0.72, 0.81, 0.66],
  "texture.terrain.gravel": [0.86, 0.84, 0.78],
  "texture.terrain.mud-sparse-grass": [0.78, 0.83, 0.68],
  "texture.road.asphalt-damaged": [0.62, 0.64, 0.65],
};
