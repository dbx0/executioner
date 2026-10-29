import type { Project } from '@exe/project'
import type { EventBus } from './events.js'

export type ChangeTopic = 'targets' | 'findings' | 'scope' | 'runs'

const DEFAULT_DELAY_MS = 250

/**
 * Wraps the shared repository instances so any write publishes a `change` event
 * for its topic. Bursts (a subdomain scan upserting hundreds of targets) are
 * coalesced: the first write starts a timer, later writes during the wait are
 * absorbed, and one event goes out when it fires. The renderer refetches on it.
 * Returns an uninstall function that restores the original methods.
 */
export function publishChanges(project: Project, bus: EventBus, opts: { delayMs?: number } = {}): () => void {
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS
  const pending = new Map<ChangeTopic, ReturnType<typeof setTimeout>>()
  const restores: Array<() => void> = []

  const mark = (topic: ChangeTopic): void => {
    if (pending.has(topic)) return
    pending.set(
      topic,
      setTimeout(() => {
        pending.delete(topic)
        bus.publish({ type: 'change', executionId: '', nodeId: topic, data: '{}' })
      }, delayMs),
    )
  }

  const wrap = (repo: object, methods: string[], topic: ChangeTopic): void => {
    for (const method of methods) {
      const original: unknown = Reflect.get(repo, method)
      if (typeof original !== 'function') continue
      Reflect.set(repo, method, (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(original, repo, args)
        mark(topic)
        return result
      })
      restores.push(() => {
        Reflect.set(repo, method, original)
      })
    }
  }

  wrap(project.targets, ['upsert', 'update', 'removeSubtree', 'reevaluateScope'], 'targets')
  wrap(project.findings, ['create', 'record', 'update', 'remove'], 'findings')
  wrap(project.scopeRules, ['add', 'update', 'remove'], 'scope')
  wrap(project.runs, ['createExecution', 'finishExecution'], 'runs')

  return () => {
    for (const restore of restores) restore()
    for (const timer of pending.values()) clearTimeout(timer)
    pending.clear()
  }
}
