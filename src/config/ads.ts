export interface SinglePlayerAdsConfig {
  client: string;
}

export const SINGLE_PLAYER_AD_TIMEOUT_MS = 2_000;
export const SINGLE_PLAYER_AD_INTERVAL_MS = 5 * 60_000;
export const SINGLE_PLAYER_AD_STORAGE_KEY = "last-line.start-ad.v1";

export function getSinglePlayerAdsConfig(
  enabled: unknown,
  client: unknown,
): SinglePlayerAdsConfig | null {
  if (enabled !== "true" || typeof client !== "string") return null;
  const publisher = client.trim();
  return /^ca-pub-\d{16}$/.test(publisher) ? { client: publisher } : null;
}
