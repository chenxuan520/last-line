export class SnapshotThrottle {
  private lastEmissionMs = Number.NEGATIVE_INFINITY;

  public constructor(private readonly minimumIntervalMs: number) {}

  public reset(nowMs: number): void {
    this.lastEmissionMs = nowMs - this.minimumIntervalMs;
  }

  public consume(nowMs: number): boolean {
    if (nowMs < this.lastEmissionMs) this.reset(nowMs);
    if (nowMs - this.lastEmissionMs < this.minimumIntervalMs) return false;
    this.lastEmissionMs = nowMs;
    return true;
  }
}
