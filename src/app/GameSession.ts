import type { Scene } from "@babylonjs/core/scene";

export interface GameSession {
  readonly scene: Scene;
  start(): void;
  update(frameSeconds: number, fps: number): void;
  dispose(): void;
}
