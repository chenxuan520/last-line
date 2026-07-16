export interface SafeZoneStageConfig {
  waitSeconds: number;
  shrinkSeconds: number;
  radius: number;
  damagePerSecond: number;
}

export interface BattleRoyaleConfig {
  participantCount: number;
  flightSeconds: number;
  safeZoneStages: readonly SafeZoneStageConfig[];
}

export const BATTLE_ROYALE_CONFIG: BattleRoyaleConfig = {
  participantCount: 20,
  flightSeconds: 30,
  safeZoneStages: [
    { waitSeconds: 180, shrinkSeconds: 100, radius: 285, damagePerSecond: 1 },
    { waitSeconds: 150, shrinkSeconds: 90, radius: 190, damagePerSecond: 2 },
    { waitSeconds: 120, shrinkSeconds: 80, radius: 115, damagePerSecond: 4 },
    { waitSeconds: 90, shrinkSeconds: 70, radius: 55, damagePerSecond: 7 },
    { waitSeconds: 55, shrinkSeconds: 50, radius: 16, damagePerSecond: 12 },
    { waitSeconds: 25, shrinkSeconds: 40, radius: 0, damagePerSecond: 30 },
  ],
};

export const FAST_BATTLE_ROYALE_CONFIG: BattleRoyaleConfig = {
  participantCount: 20,
  flightSeconds: 1,
  safeZoneStages: [
    { waitSeconds: 0.5, shrinkSeconds: 0.5, radius: 180, damagePerSecond: 10 },
    { waitSeconds: 0.2, shrinkSeconds: 0.5, radius: 40, damagePerSecond: 30 },
    { waitSeconds: 0.1, shrinkSeconds: 0.5, radius: 0, damagePerSecond: 100 },
  ],
};
