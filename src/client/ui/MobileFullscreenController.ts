import { supportsTouchInput } from "../../controllers/HumanController";

export interface MobileFullscreenControllerOptions {
  document?: Document;
  screen?: Screen;
  target?: HTMLElement;
  touchInput?: boolean;
}

export class MobileFullscreenController {
  private readonly documentTarget: Document;
  private readonly screenTarget: Screen | null;
  private readonly target: HTMLElement;
  private readonly touchInput: boolean;
  private active = false;
  private pending = false;
  private failed = false;
  private orientationLocked = false;
  private operation = 0;

  public constructor(options: MobileFullscreenControllerOptions = {}) {
    this.documentTarget = options.document ?? document;
    this.screenTarget = options.screen ?? (typeof screen === "undefined" ? null : screen);
    this.target = options.target ?? this.documentTarget.documentElement;
    this.touchInput = options.touchInput ?? supportsTouchInput();
  }

  public activateFromUserGesture(): void {
    this.active = true;
    this.requestFromUserGesture();
  }

  public activateWithoutUserGesture(): void {
    this.active = true;
  }

  public requestFromUserGesture(): void {
    if (!this.active || !this.isSupported() || this.pending) return;
    const operation = ++this.operation;
    this.pending = true;
    this.failed = false;
    let fullscreen: Promise<void>;
    try {
      fullscreen = this.documentTarget.fullscreenElement === this.target
        ? Promise.resolve()
        : this.target.requestFullscreen();
    } catch {
      this.finish(operation, true);
      return;
    }
    void fullscreen
      .then(() => this.lockLandscape(operation))
      .then(() => this.finish(operation, false))
      .catch(() => this.finish(operation, true));
  }

  public needsAction(orientationBlocked: boolean): boolean {
    if (!this.active || !this.isSupported() || this.pending) return false;
    if (orientationBlocked) return this.failed;
    return this.documentTarget.fullscreenElement !== this.target;
  }

  public deactivate(): void {
    this.active = false;
    this.pending = false;
    this.failed = false;
    this.operation += 1;
    if (this.orientationLocked) {
      try {
        this.screenTarget?.orientation.unlock();
      } catch {
        // The browser may already have released the lock.
      }
      this.orientationLocked = false;
    }
  }

  public dispose(): void {
    this.deactivate();
  }

  private isSupported(): boolean {
    return this.touchInput &&
      this.documentTarget.fullscreenEnabled !== false &&
      typeof this.target.requestFullscreen === "function";
  }

  private async lockLandscape(operation: number): Promise<void> {
    if (!this.isCurrent(operation)) return;
    const orientation = this.screenTarget?.orientation;
    if (!orientation || typeof orientation.lock !== "function") return;
    await orientation.lock("landscape");
    if (this.isCurrent(operation)) {
      this.orientationLocked = true;
      return;
    }
    try {
      orientation.unlock();
    } catch {
      // A stale lock may already have been released by the browser.
    }
  }

  private finish(operation: number, failed: boolean): void {
    if (!this.isCurrent(operation)) return;
    this.pending = false;
    this.failed = failed;
  }

  private isCurrent(operation: number): boolean {
    return this.active && this.operation === operation;
  }
}
