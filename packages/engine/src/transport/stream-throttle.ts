import type { EventBus } from './events.js'

/**
 * Coalesces a child process's stdout/stderr into at most one bus event per
 * `intervalMs` (or immediately once the pending buffer reaches `maxChars`).
 *
 * Why: a chatty tool (subdomain enumeration, port scans) can emit thousands of
 * tiny stdout chunks. Publishing each as its own `/events` frame floods the
 * desktop client, whose per-message `JSON.parse` then saturates the main thread
 * and freezes the UI for as long as the burst lasts. Batching collapses a burst
 * into a few larger frames while preserving order and content.
 *
 * Call `push` for each chunk and `flush` once the stream ends (on close), so no
 * trailing text is lost.
 */
export interface StreamThrottle {
  push(text: string): void
  flush(): void
}

export function createStreamThrottle(opts: {
  bus: EventBus
  type: 'stdout' | 'stderr'
  executionId: string
  nodeId: string
  intervalMs?: number
  maxChars?: number
}): StreamThrottle {
  const intervalMs = opts.intervalMs ?? 60
  const maxChars = opts.maxChars ?? 16000
  let buffer = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  const emit = (): void => {
    if (buffer === '') return
    const data = buffer
    buffer = ''
    opts.bus.publish({ type: opts.type, executionId: opts.executionId, nodeId: opts.nodeId, data })
  }

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    emit()
  }

  const push = (text: string): void => {
    buffer += text
    if (buffer.length >= maxChars) {
      flush()
      return
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined
        emit()
      }, intervalMs)
    }
  }

  return { push, flush }
}
