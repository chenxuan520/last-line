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
  participantCount: 50,
  flightSeconds: 60,
  safeZoneStages: [
    { waitSeconds: 180, shrinkSeconds: 100, radius: 860, damagePerSecond: 1 },
    { waitSeconds: 150, shrinkSeconds: 90, radius: 590, damagePerSecond: 2 },
    { waitSeconds: 70, shrinkSeconds: 45, radius: 350, damagePerSecond: 4 },
    { waitSeconds: 35, shrinkSeconds: 28, radius: 164, damagePerSecond: 7 },
    { waitSeconds: 15, shrinkSeconds: 16, radius: 48, damagePerSecond: 12 },
    { waitSeconds: 5, shrinkSeconds: 8, radius: 0, damagePerSecond: 30 },
  ],
};

export const FAST_BATTLE_ROYALE_CONFIG: BattleRoyaleConfig = {
  participantCount: 50,
  flightSeconds: 1,
  safeZoneStages: [
    { waitSeconds: 0.5, shrinkSeconds: 0.5, radius: 520, damagePerSecond: 10 },
    { waitSeconds: 0.2, shrinkSeconds: 0.5, radius: 130, damagePerSecond: 30 },
    { waitSeconds: 0.1, shrinkSeconds: 0.5, radius: 0, damagePerSecond: 100 },
  ],
};
