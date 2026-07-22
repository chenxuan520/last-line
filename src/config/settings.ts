export type QualityLevel = "low" | "medium" | "high";

export interface QualityProfile {
  hardwareScalingLevel: number;
  maxFps: number;
  treeCount: number;
  mountainTreeCount: number;
  decorativeRockCount: number;
  mountainRockCount: number;
  shrubCount: number;
  modelLodDistance: number;
}

export interface GameSettings {
  quality: QualityLevel;
  volume: number;
  sensitivity: number;
  startWithBandage: boolean;
  disableAiSnipers: boolean;
  showGroundLootModels: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: "medium",
  volume: 0,
  sensitivity: 1,
  startWithBandage: true,
  disableAiSnipers: true,
  showGroundLootModels: true,
};

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = {
  low: {
    hardwareScalingLevel: 1.75,
    maxFps: 60,
    treeCount: 128,
    mountainTreeCount: 64,
    decorativeRockCount: 32,
    mountainRockCount: 16,
    shrubCount: 60,
    modelLodDistance: 35,
  },
  medium: {
    hardwareScalingLevel: 1.35,
    maxFps: 90,
    treeCount: 256,
    mountainTreeCount: 112,
    decorativeRockCount: 64,
    mountainRockCount: 32,
    shrubCount: 120,
    modelLodDistance: 50,
  },
  high: {
    hardwareScalingLevel: 1,
    maxFps: 120,
    treeCount: 384,
    mountainTreeCount: 160,
    decorativeRockCount: 96,
    mountainRockCount: 48,
    shrubCount: 180,
    modelLodDistance: 65,
  },
};
