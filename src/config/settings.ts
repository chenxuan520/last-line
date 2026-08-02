import { DEFAULT_MAP_ID, type MapId } from "./maps";

export type QualityLevel = "low" | "medium" | "high";

export interface QualityProfile {
  hardwareScalingLevel: number;
  maxFps: number;
  foliageTessellation: number;
  decorativeRockCount: number;
  mountainRockCount: number;
  shrubCount: number;
  modelLodDistance: number;
}

export interface GameSettings {
  mapId: MapId;
  quality: QualityLevel;
  volume: number;
  sensitivity: number;
  startWithBandage: boolean;
  disableAiSnipers: boolean;
  showGroundLootModels: boolean;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mapId: DEFAULT_MAP_ID,
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
    foliageTessellation: 5,
    decorativeRockCount: 32,
    mountainRockCount: 16,
    shrubCount: 60,
    modelLodDistance: 35,
  },
  medium: {
    hardwareScalingLevel: 1.35,
    maxFps: 90,
    foliageTessellation: 6,
    decorativeRockCount: 64,
    mountainRockCount: 32,
    shrubCount: 120,
    modelLodDistance: 50,
  },
  high: {
    hardwareScalingLevel: 1,
    maxFps: 120,
    foliageTessellation: 7,
    decorativeRockCount: 96,
    mountainRockCount: 48,
    shrubCount: 180,
    modelLodDistance: 65,
  },
};

export function normalizeSensitivity(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0.4, Math.min(2, value))
    : DEFAULT_SETTINGS.sensitivity;
}

export function usesMobileDevicePixels(
  matchMedia: ((query: string) => { readonly matches: boolean }) | undefined,
): boolean {
  return matchMedia?.("(pointer: coarse)").matches === true;
}

export function renderHardwareScalingLevel(
  quality: QualityLevel,
  devicePixelRatio: number,
  useDevicePixels: boolean,
): number {
  const profileScaling = QUALITY_PROFILES[quality].hardwareScalingLevel;
  if (!useDevicePixels) return profileScaling;
  const pixelRatio = Number.isFinite(devicePixelRatio) ? Math.max(1, devicePixelRatio) : 1;
  const effectivePixelRatio = Math.min(pixelRatio, 2);
  return profileScaling / effectivePixelRatio;
}
