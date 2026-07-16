export class FixedStepClock {
  private accumulatorSeconds = 0;

  public constructor(
    private readonly stepSeconds = 1 / 30,
    private readonly maxFrameSeconds = 0.25,
  ) {}

  public advance(frameSeconds: number, step: (deltaSeconds: number) => void): number {
    this.accumulatorSeconds += Math.min(Math.max(frameSeconds, 0), this.maxFrameSeconds);
    let steps = 0;
    const epsilon = this.stepSeconds * 1e-9;

    while (this.accumulatorSeconds + epsilon >= this.stepSeconds) {
      step(this.stepSeconds);
      this.accumulatorSeconds = Math.max(0, this.accumulatorSeconds - this.stepSeconds);
      steps += 1;
    }

    return steps;
  }

  public reset(): void {
    this.accumulatorSeconds = 0;
  }
}
