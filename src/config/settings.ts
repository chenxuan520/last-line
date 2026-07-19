export type QualityLevel = "low" | "medium" | "high";

export interface GameSettings {
  quality: QualityLevel;
  volume: number;
  sensitivity: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: "medium",
  volume: 0,
  sensitivity: 1,
};
