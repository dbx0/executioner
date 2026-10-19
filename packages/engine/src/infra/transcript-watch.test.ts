import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventBus, type EngineEvent } from '../transport/events.js'
import { TranscriptWatchers } from './transcript-watch.js'

/** A minimal Claude transcript record: assistant tool_use block(s). */
function toolUseLine(name: 'Task' | 'Agent', id: string, description: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, id, input: { description } }] },
  })
}

/** A <task-notification> user record naming a parent tool-use-id + child task-id. */
function notificationLine(toolUseId: string, taskId: string, status: string): string {
  const text = `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n</task-notification>`
  return JSON.stringify({ type: 'user', message: { content: text } })
}

describe('TranscriptWatchers — nested sub-agent lineage', () => {
  let dir: string
  let bus: EventBus
  let events: EngineEvent[]
  let watchers: TranscriptWatchers

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'exe-transcript-'))
    bus = new EventBus()
    events = []
    bus.subscribe((e) => events.push(e))
    watchers = new TranscriptWatchers(bus)
  })
  afterEach(() => {
    watchers.stop('sess')
    rmSync(dir, { recursive: true, force: true })
  })

  function subagentPayloads(nodeId: 'subagent-start' | 'subagent-stop'): Array<Record<string, unknown>> {
    return events
      .filter((e) => e.type === 'agent' && e.executionId === 'sess' && e.nodeId === nodeId)
      .map((e) => JSON.parse(e.data) as Record<string, unknown>)
  }

  it('discovers a sub-agent AND its own nested sub-agent, tagging the child with parentId', () => {
    // Lead transcript at <dir>/sess.jsonl → subagents dir <dir>/sess/subagents.
    const leadPath = join(dir, 'sess.jsonl')
    const subagentsDir = join(dir, 'sess', 'subagents')
    mkdirSync(subagentsDir, { recursive: true })

    // The depth-1 child's transcript is named after its task-id (agent-id). Its
    // OWN Task tool_use (the grandchild) lives inside it, not the lead.
    const childAgentId = 'a350aff3ea1c7d14f'
    const childPath = join(subagentsDir, `agent-${childAgentId}.jsonl`)
    writeFileSync(childPath, toolUseLine('Task', 'toolu_child', 'nested build') + '\n')

    // Lead records: start the child, then a notification mapping its
    // tool-use-id → task-id (so its transcript can be located), then complete it.
    writeFileSync(
      leadPath,
      [
        toolUseLine('Task', 'toolu_parent', 'parent recon'),
        notificationLine('toolu_parent', childAgentId, 'running'),
        notificationLine('toolu_parent', childAgentId, 'completed'),
      ].join('\n') + '\n',
    )

    watchers.observe('sess', leadPath)

    const starts = subagentPayloads('subagent-start')
    // The lead's direct child has no parentId (top level).
    expect(starts).toContainEqual({ id: 'toolu_parent', description: 'parent recon' })
    // The nested sub-agent, discovered by tailing the child transcript, links to
    // its parent via parentId (the parent's tool-use-id).
    expect(starts).toContainEqual({ id: 'toolu_child', description: 'nested build', parentId: 'toolu_parent' })

    // The terminal notification for the direct child still stops it.
    expect(subagentPayloads('subagent-stop')).toContainEqual({ id: 'toolu_parent', status: 'completed' })
  })

  it('is idempotent per transcript path and does not re-observe', () => {
    const leadPath = join(dir, 'sess.jsonl')
    writeFileSync(leadPath, toolUseLine('Task', 'toolu_a', 'only child') + '\n')
    watchers.observe('sess', leadPath)
    watchers.observe('sess', leadPath) // second call must not re-emit
    expect(subagentPayloads('subagent-start')).toEqual([{ id: 'toolu_a', description: 'only child' }])
  })
})
