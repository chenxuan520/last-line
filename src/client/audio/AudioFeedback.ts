import type { GameEvent } from "../../game/state/types";

export class AudioFeedback {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;

  public constructor(private volume: number) {}

  public setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.gain) this.gain.gain.value = this.volume * 0.16;
  }

  public start(): void {
    if (this.volume <= 0) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume * 0.16;
      this.gain.connect(this.context.destination);
    }
    void this.context.resume();
  }

  public handleEvents(events: readonly GameEvent[], playerId: string): void {
    if (!this.context || !this.gain) return;
    for (const event of events) {
      if (event.type === "shot-fired" && event.actorId === playerId) this.tone(110, 0.055, "sawtooth");
      if (event.type === "actor-damaged" && event.actorId === playerId) this.tone(62, 0.14, "square");
      if (event.type === "item-picked" && event.actorId === playerId) this.tone(620, 0.08, "sine");
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
