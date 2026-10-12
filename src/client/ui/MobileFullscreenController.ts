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
  private exitWhenInactive = false;
  private operation = 0;
  private readonly pendingOperations = new Set<Promise<void>>();
  private exitPromise: Promise<void> | null = null;

  public constructor(options: MobileFullscreenControllerOptions = {}) {
    this.documentTarget = options.document ?? document;
    this.screenTarget = options.screen ?? (typeof screen === "undefined" ? null : screen);
    this.target = options.target ?? this.documentTarget.documentElement;
    this.touchInput = options.touchInput ?? supportsTouchInput();
  }

  public activateFromUserGesture(): void {
    this.active = true;
    this.exitWhenInactive = false;
    this.requestFromUserGesture();
  }

  public activateWithoutUserGesture(): void {
    this.active = true;
    this.exitWhenInactive = false;
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
    this.trackOperation(fullscreen
      .then(() => this.lockLandscape(operation))
      .then(() => this.finish(operation, false))
      .catch(() => this.finish(operation, true)));
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

  public exitAfterFailure(): void {
    this.deactivate();
    this.exitWhenInactive = true;
    this.exitOwnFullscreen();
  }

  // 迟到的进入／方向锁完成还可能创建退出任务，必须排空整条操作链后才能重开。
  public async waitForFailureExit(): Promise<void> {
    while (this.pendingOperations.size > 0) await Promise.all(this.pendingOperations);
  }

  private trackOperation(promise: Promise<void>): Promise<void> {
    const tracked = promise.finally(() => { this.pendingOperations.delete(tracked); });
    this.pendingOperations.add(tracked);
    return tracked;
  }

  private exitOwnFullscreen(): void {
    if (this.active || !this.exitWhenInactive || this.exitPromise || this.documentTarget.fullscreenElement !== this.target) return;
    try {
      if (typeof this.documentTarget.exitFullscreen === "function") {
        this.exitPromise = this.trackOperation(Promise.resolve(this.documentTarget.exitFullscreen())
          .catch(() => undefined)
          .finally(() => { this.exitPromise = null; }));
      }
    } catch {
      // 旧浏览器同步拒绝退出时，错误页仍可操作。
    }
  }

  private isSupported(): boolean {
    return this.touchInput &&
      this.documentTarget.fullscreenEnabled !== false &&
      typeof this.target.requestFullscreen === "function";
  }

  private async lockLandscape(operation: number): Promise<void> {
    if (!this.isCurrent(operation)) {
      this.exitOwnFullscreen();
      return;
    }
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
    this.exitOwnFullscreen();
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
