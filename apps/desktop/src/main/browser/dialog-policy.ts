import type { DialogChoice } from '@exe/protocol'

export type DialogDecision = { by: 'agent'; accept: boolean; promptText?: string | undefined } | { by: 'operator' }

/**
 * Decides who answers a JavaScript dialog. A dialog opened by the agent's own
 * action (or just after it, since a click often fires the alert a tick later)
 * is answered for the agent; anything else is the operator's to answer.
 */
export class DialogPolicy {
  private active = 0
  private lastEnd = -Infinity
  private choice: { dialog?: DialogChoice | undefined; promptText?: string | undefined } = {}

  constructor(
    private readonly now: () => number,
    private readonly windowMs = 2000,
  ) {}

  begin(choice: { dialog?: DialogChoice | undefined; promptText?: string | undefined }): () => void {
    this.active++
    this.choice = { dialog: choice.dialog, promptText: choice.promptText }
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.active--
      this.lastEnd = this.now()
    }
  }

  decide(): DialogDecision {
    if (this.active > 0 || this.now() - this.lastEnd < this.windowMs) {
      return { by: 'agent', accept: this.choice.dialog === 'accept', promptText: this.choice.promptText }
    }
    return { by: 'operator' }
  }
}
