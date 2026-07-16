export interface WeaponConfig {
  id: string;
  label: string;
  ammoItemId: string;
  damage: number;
  roundsPerMinute: number;
  magazineSize: number;
  reloadSeconds: number;
  range: number;
  spreadRadians: number;
  pellets: number;
  recoil: number;
}

export const WEAPONS: Readonly<Record<string, WeaponConfig>> = {
  rifle: {
    id: "rifle",
    label: "R-7 步枪",
    ammoItemId: "ammo.rifle",
    damage: 34,
    roundsPerMinute: 600,
    magazineSize: 30,
    reloadSeconds: 1.8,
    range: 170,
    spreadRadians: 0.012,
    pellets: 1,
    recoil: 0.012,
  },
  smg: {
    id: "smg",
    label: "V-9 冲锋枪",
    ammoItemId: "ammo.light",
    damage: 22,
    roundsPerMinute: 820,
    magazineSize: 32,
    reloadSeconds: 1.55,
    range: 90,
    spreadRadians: 0.022,
    pellets: 1,
    recoil: 0.008,
  },
  shotgun: {
    id: "shotgun",
    label: "K-12 霰弹枪",
    ammoItemId: "ammo.shell",
    damage: 13,
    roundsPerMinute: 90,
    magazineSize: 6,
    reloadSeconds: 2.4,
    range: 42,
    spreadRadians: 0.075,
    pellets: 8,
    recoil: 0.035,
  },
};
