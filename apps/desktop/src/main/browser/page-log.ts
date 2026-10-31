export interface LogEntry {
  seq: number
  at: number
  kind: 'console' | 'dialog' | 'error'
  level?: string
  text: string
  url: string
  dialogType?: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  handledBy?: 'agent' | 'operator' | 'timeout'
}

/** A bounded ring of what the page said, read by cursor so each poll only sees what is new. */
export class PageLog {
  private entries: LogEntry[] = []
  private seq = 0

  constructor(private readonly cap = 500) {}

  /** Returns the stored entry, so a dialog's `handledBy` can be set once it settles. */
  push(e: Omit<LogEntry, 'seq' | 'at'>): LogEntry {
    const entry: LogEntry = { ...e, seq: ++this.seq, at: Date.now() }
    this.entries.push(entry)
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap)
    return entry
  }

  since(seq = 0): { entries: LogEntry[]; next: number } {
    return { entries: this.entries.filter((e) => e.seq > seq), next: this.seq }
  }
}
