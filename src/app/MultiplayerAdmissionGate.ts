export class MultiplayerAdmissionGate {
  private generation = 0;
  private activeToken: number | null = null;

  public get pending(): boolean {
    return this.activeToken !== null;
  }

  public begin(): boolean {
    return this.beginAttempt() !== null;
  }

  public beginAttempt(): number | null {
    if (this.activeToken !== null) return null;
    this.generation += 1;
    this.activeToken = this.generation;
    return this.activeToken;
  }

  public end(token?: number): void {
    if (token !== undefined && token !== this.activeToken) return;
    this.activeToken = null;
  }

  public isActive(token: number): boolean {
    return token === this.activeToken;
  }

  public reset(): void {
    this.generation += 1;
    this.activeToken = null;
  }
}

export function ownsMultiplayerConnection<T>(
  activeConnection: T | null,
  candidate: T,
): boolean {
  return activeConnection === candidate;
}

export function admissionAttemptOwnsSideEffects(
  gate: MultiplayerAdmissionGate,
  token: number,
  ownerConnected: boolean,
): boolean {
  return ownerConnected && gate.isActive(token);
}
