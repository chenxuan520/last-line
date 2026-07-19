import type { GameEvent, Vector3State } from "../../game/state/types";

interface AudioListenerState {
  playerId: string;
  observerId: string;
  position: Vector3State;
}

interface GunshotProfile {
  frequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  range: number;
}

const GUNSHOT_PROFILES: Readonly<Record<string, GunshotProfile>> = {
  rifle: { frequency: 145, duration: 0.085, type: "sawtooth", gain: 0.9, range: 300 },
  smg: { frequency: 210, duration: 0.05, type: "square", gain: 0.62, range: 180 },
  shotgun: { frequency: 82, duration: 0.14, type: "sawtooth", gain: 1, range: 160 },
  sniper: { frequency: 118, duration: 0.18, type: "sawtooth", gain: 1, range: 600 },
};
const MAX_REMOTE_GUNSHOTS_PER_TICK = 4;
const MAX_ACTIVE_LOCAL_GUNSHOTS = 2;
const MAX_ACTIVE_REMOTE_GUNSHOTS = 6;

export class AudioFeedback {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private activeLocalGunshots = 0;
  private activeRemoteGunshots = 0;

  public constructor(private volume: number) {}

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume * 0.2;
  }

  public start(): void {
    if (this.volume <= 0) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume * 0.2;
      this.gain.connect(this.context.destination);
    }
    void this.context.resume();
  }

  public handleEvents(events: readonly GameEvent[], listener: AudioListenerState): void {
    if (this.volume <= 0 || !this.context || !this.gain) return;
    const shots = events.filter((event) => event.type === "shot-fired");
    for (const event of shots.filter((shot) => shot.actorId === listener.observerId)) {
      this.gunshot(event.weaponId, 1, false);
    }
    const remoteShots = shots
      .filter((shot) => shot.actorId !== listener.observerId)
      .map((shot) => ({
        shot,
        distance: Math.hypot(
          shot.origin.x - listener.position.x,
          shot.origin.y - listener.position.y,
          shot.origin.z - listener.position.z,
        ),
      }))
      .filter(({ shot, distance }) => gunshotDistanceGain(distance, GUNSHOT_PROFILES[shot.weaponId]?.range ?? 240) > 0)
      .sort((left, right) => left.distance - right.distance || left.shot.actorId.localeCompare(right.shot.actorId))
      .slice(0, MAX_REMOTE_GUNSHOTS_PER_TICK);
    for (const { shot, distance } of remoteShots) {
      this.gunshot(
        shot.weaponId,
        gunshotDistanceGain(distance, GUNSHOT_PROFILES[shot.weaponId]?.range ?? 240),
        true,
      );
    }
    for (const event of events) {
      if (event.type === "actor-damaged" && event.actorId === listener.playerId) this.tone(62, 0.14, "square");
      if (event.type === "item-picked" && event.actorId === listener.playerId) this.tone(620, 0.08, "sine");
    }
  }

  public preview(): void {
    if (this.volume <= 0) return;
    this.start();
    this.tone(520, 0.08, "sine");
  }

  public dispose(): void {
    void this.context?.close();
    this.context = null;
    this.gain = null;
    this.activeLocalGunshots = 0;
    this.activeRemoteGunshots = 0;
  }

  private gunshot(weaponId: string, gainScale: number, remote: boolean): void {
    const context = this.context;
    const masterGain = this.gain;
    const profile = GUNSHOT_PROFILES[weaponId] ?? GUNSHOT_PROFILES.rifle;
    const activeVoices = remote ? this.activeRemoteGunshots : this.activeLocalGunshots;
    const voiceLimit = remote ? MAX_ACTIVE_REMOTE_GUNSHOTS : MAX_ACTIVE_LOCAL_GUNSHOTS;
    if (!context || !masterGain || !profile || gainScale <= 0 || activeVoices >= voiceLimit) return;
    if (remote) this.activeRemoteGunshots += 1;
    else this.activeLocalGunshots += 1;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = profile.type;
    oscillator.frequency.setValueAtTime(profile.frequency * 1.8, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(profile.frequency, context.currentTime + profile.duration);
    envelope.gain.setValueAtTime(Math.max(0.001, profile.gain * gainScale), context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, context.currentTime + profile.duration);
    oscillator.connect(envelope);
    envelope.connect(masterGain);
    oscillator.onended = () => {
      if (remote) this.activeRemoteGunshots = Math.max(0, this.activeRemoteGunshots - 1);
      else this.activeLocalGunshots = Math.max(0, this.activeLocalGunshots - 1);
      oscillator.disconnect();
      envelope.disconnect();
    };
    oscillator.start();
    oscillator.stop(context.currentTime + profile.duration);
  }

  private tone(frequency: number, duration: number, type: OscillatorType): void {
    const context = this.context;
    const gain = this.gain;
    if (!context || !gain) return;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.7, context.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(envelope);
    envelope.connect(gain);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }
}

export function gunshotDistanceGain(distance: number, range: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(range) || range <= 0 || distance >= range) return 0;
  const progress = Math.max(0, Math.min(1, distance / range));
  return (1 - progress) ** 2;
}
