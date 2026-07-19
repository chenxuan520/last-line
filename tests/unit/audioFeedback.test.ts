import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioFeedback } from "../../src/client/audio/AudioFeedback";
import type { GameEvent } from "../../src/game/state/types";

describe("AudioFeedback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reserves local gunshot voices when remote gunfire is saturated", () => {
    const context = new FakeAudioContext();
    vi.stubGlobal("AudioContext", function AudioContext() {
      return context;
    });
    const audio = new AudioFeedback(1);
    const listener = {
      playerId: "player",
      observerId: "player",
      position: { x: 0, y: 1.76, z: 0 },
    };
    const remoteShots = Array.from({ length: 4 }, (_, index): GameEvent => ({
      type: "shot-fired",
      actorId: `bot-${index + 1}`,
      weaponId: "rifle",
      origin: { x: index + 1, y: 1.76, z: 0 },
    }));
    audio.start();

    audio.handleEvents(remoteShots, listener);
    audio.handleEvents(remoteShots, listener);
    expect(context.oscillators).toHaveLength(6);

    audio.handleEvents([{
      type: "shot-fired",
      actorId: "player",
      weaponId: "shotgun",
      origin: { ...listener.position },
    }], listener);
    expect(context.oscillators).toHaveLength(7);
  });
});

class FakeAudioParam {
  public value = 0;
  public setValueAtTime(value: number): void {
    this.value = value;
  }
  public exponentialRampToValueAtTime(value: number): void {
    this.value = value;
  }
}

class FakeAudioNode {
  public connect(): this {
    return this;
  }
  public disconnect(): void {}
}

class FakeGainNode extends FakeAudioNode {
  public readonly gain = new FakeAudioParam();
}

class FakeOscillatorNode extends FakeAudioNode {
  public type: OscillatorType = "sine";
  public readonly frequency = new FakeAudioParam();
  public onended: (() => void) | null = null;
  public start(): void {}
  public stop(): void {}
}

class FakeAudioContext {
  public readonly currentTime = 0;
  public readonly destination = new FakeAudioNode();
  public readonly oscillators: FakeOscillatorNode[] = [];
  public createGain(): FakeGainNode {
    return new FakeGainNode();
  }
  public createOscillator(): FakeOscillatorNode {
    const oscillator = new FakeOscillatorNode();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  public async resume(): Promise<void> {}
  public async close(): Promise<void> {}
}
