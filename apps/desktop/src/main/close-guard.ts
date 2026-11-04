export interface CloseGuardDeps {
  /** Ask the renderer to show its confirm dialog. */
  ask: () => void
  /** Ask with a native dialog instead; resolves true to close. */
  askNative: () => Promise<boolean>
  /** Close the window, once confirmed. */
  close: () => void
  /** Quit the app, once confirmed. */
  quit: () => void
  /** How long the renderer has to acknowledge before the native dialog takes over. */
  ackTimeoutMs?: number
}

/**
 * Holds every window close and app quit until the user confirms it. Closing
 * stops the engines, which ends running terminals, agents and runs, so the X,
 * Alt+F4, Cmd+Q and the taskbar all pass through one question. The renderer
 * draws the dialog; if it never acknowledges (crashed, hung, not loaded yet),
 * a native dialog asks instead, so the app can always be closed.
 */
export class CloseGuard {
  private confirmed = false
  private asking = false
  private pendingQuit = false
  private ackTimer: ReturnType<typeof setTimeout> | undefined
  private readonly ackTimeoutMs: number

  constructor(private readonly deps: CloseGuardDeps) {
    this.ackTimeoutMs = deps.ackTimeoutMs ?? 1500
  }

  /** Whether a close or quit must be prevented; the first one starts the question. */
  shouldBlock(kind: 'close' | 'quit'): boolean {
    if (this.confirmed) return false
    if (kind === 'quit') this.pendingQuit = true
    if (!this.asking) {
      this.asking = true
      this.deps.ask()
      this.ackTimer = setTimeout(() => {
        this.ackTimer = undefined
        void this.deps.askNative().then(
          (ok) => this.answer(ok),
          () => this.answer(true),
        )
      }, this.ackTimeoutMs)
    }
    return true
  }

  /** The renderer is showing its dialog, so the native fallback is not needed. */
  acknowledged(): void {
    if (this.ackTimer !== undefined) clearTimeout(this.ackTimer)
    this.ackTimer = undefined
  }

  /** The user's answer. A cancel forgets any pending quit; the next close asks again. */
  answer(ok: boolean): void {
    if (!this.asking) return
    this.acknowledged()
    this.asking = false
    const quit = this.pendingQuit
    this.pendingQuit = false
    if (!ok) return
    this.confirmed = true
    if (quit) this.deps.quit()
    else this.deps.close()
  }

  /** Let closes through without asking, e.g. when restarting to install an update. */
  allow(): void {
    this.acknowledged()
    this.asking = false
    this.confirmed = true
  }

  /** A new window starts unconfirmed again (macOS keeps the app alive between windows). */
  reset(): void {
    this.acknowledged()
    this.asking = false
    this.pendingQuit = false
    this.confirmed = false
  }
}
