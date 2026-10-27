import { isoNow } from '@exe/protocol'
import { MetaRepository } from './adopt.js'
import type { ProjectDatabase } from './orm.js'
import { workflows } from './tables.js'

/** The user-level `meta` key marking that the starter workflows were handed out. */
export const STARTERS_SEEDED_KEY = 'starter_workflows_seeded'

interface StarterWorkflow {
  id: string
  name: string
  graph: { nodes: unknown[]; edges: unknown[] }
}

/** A trigger fanning out to independent steps, laid out as one column. */
function fanOut(
  trigger: { id: string; type: string; data: Record<string, unknown> },
  steps: Array<{ id: string; type: string; data?: Record<string, unknown> }>,
): StarterWorkflow['graph'] {
  return {
    nodes: [
      { ...trigger, position: { x: 80, y: 70 * (steps.length - 1) } },
      ...steps.map((s, i) => ({ id: s.id, type: s.type, data: s.data ?? {}, position: { x: 360, y: 140 * i } })),
    ],
    edges: steps.map((s, i) => ({ id: `e${String(i + 1)}`, source: trigger.id, target: s.id, sourceHandle: null })),
  }
}

/**
 * The workflows a fresh install starts with, so the list is not empty on day
 * one. Both are on_create workflows built from bundled manifest nodes that
 * write their own targets and facts; arming one is a schedule in the
 * engagement, which the trigger prefills. Ids are stable so a re-seed (two
 * engines opening at once) can never write a second copy.
 */
export const STARTER_WORKFLOWS: readonly StarterWorkflow[] = [
  {
    id: 'starter-domain-recon',
    name: 'Domain recon',
    graph: fanOut({ id: 'trigger', type: 'on_create', data: { target_kind: 'domain' } }, [
      { id: 'whois', type: 'whois' },
      { id: 'dns_a', type: 'dig', data: { record_type: 'A' } },
      { id: 'subdomains', type: 'subfinder' },
      { id: 'http_probe', type: 'httpx' },
    ]),
  },
  {
    id: 'starter-host-scan',
    name: 'Host scan',
    graph: fanOut({ id: 'trigger', type: 'on_create', data: { target_kind: 'ip' } }, [
      { id: 'whois', type: 'whois' },
      { id: 'ports', type: 'nmap', data: { ports: '1-1000', scan_type: '-sV', timing: '-T4' } },
    ]),
  },
]

const STARTER_IDS = new Set(STARTER_WORKFLOWS.map((s) => s.id))

/** True for a workflow id the starter seed wrote. */
export function isStarterWorkflow(id: string): boolean {
  return STARTER_IDS.has(id)
}

/**
 * Hand the starter workflows to the user-level database, once. The marker makes
 * it one-way: a starter the user deleted or renamed is left as they left it.
 * Returns how many were written.
 */
export function seedStarterWorkflows(global: ProjectDatabase): number {
  const marker = new MetaRepository(global)
  if (marker.get(STARTERS_SEEDED_KEY) !== undefined) return 0

  let written = 0
  const now = isoNow()
  for (const starter of STARTER_WORKFLOWS) {
    written += global.orm
      .insert(workflows)
      .values({ id: starter.id, name: starter.name, graph: JSON.stringify(starter.graph), createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .run().changes
  }
  marker.set(STARTERS_SEEDED_KEY, now)
  return written
}
