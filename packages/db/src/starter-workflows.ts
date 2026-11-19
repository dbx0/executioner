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

/** How far apart the recon workflow's columns and rows sit on the canvas. */
const COLUMN = 300
const ROW = 110

/**
 * A full pass over a domain, run by hand. It is built from nodes alone: each
 * one saves what it finds on the host it ran against, so there is no script and
 * no save node, and the loop walks subfinder's own rows.
 *
 * The domain is looked at from every side at once. Its subdomains are then
 * probed one by one, and only the ones that answer get the closer look, since
 * fingerprinting, screenshotting and scanning a name that serves nothing is
 * requests spent for no result. Scope is not decided here: every subdomain
 * subfinder saves is judged against the engagement's scope rules as it lands.
 */
function reconGraph(): StarterWorkflow['graph'] {
  const nodes: unknown[] = []
  const edges: unknown[] = []
  const node = (id: string, type: string, column: number, row: number, data: Record<string, unknown> = {}): void => {
    nodes.push({ id, type, data, position: { x: 80 + column * COLUMN, y: 60 + row * ROW } })
  }
  const edge = (source: string, target: string, sourceHandle: string | null = null): void => {
    edges.push({ id: `e${String(edges.length + 1)}`, source, target, sourceHandle })
  }

  // Exposed files and leaked tokens, leaving out the informational matches that
  // would bury a real one. The scan is the slow step, so it gets room to finish.
  const exposures = { tags: 'exposure,token', severity: 'low,medium,high,critical', __timeout_ms: 600_000 }
  const finding = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: '{{ row.info.name }}',
    severity: '{{ row.info.severity }}',
    description: 'Reported by the nuclei template {{ row.template-id }}.',
    details: 'Matched at {{ row.matched-at }}',
    ...extra,
  })

  node('trigger', 'manual', 0, 4)

  node('whois', 'whois', 1, 0)
  node('dns', 'dns_records', 1, 1)
  node('http', 'httpx', 1, 2)
  node('tech', 'whatweb', 1, 3)
  node('waf', 'wafw00f', 1, 4)
  node('ports', 'nmap', 1, 5, { ports: '80,443,8080,8443,9443', scan_type: '-sV', timing: '-T3' })
  node('shot', 'screenshot', 1, 6, { full_page: true })
  node('exposures', 'nuclei', 1, 7, exposures)
  node('find_exposures', 'save_to_finding', 2, 7, finding())
  node('subs', 'subfinder', 1, 8, { __timeout_ms: 300_000 })
  for (const id of ['whois', 'dns', 'http', 'tech', 'waf', 'ports', 'shot', 'exposures', 'subs']) edge('trigger', id)
  edge('exposures', 'find_exposures')

  const sub = '{{ loop.item.host }}'
  // A wildcard domain can hand back tens of thousands of names. The cap is on
  // the node, in plain sight, for the operator to raise.
  node('each_sub', 'loop', 2, 8, { source: '{{ nodes.subs.rows }}', max_items: 50 })
  node('sub_http', 'httpx', 3, 8, { target: sub })
  // A host that did not answer has no row at all, hence the fallback.
  node('if_live', 'if', 4, 8, { expression: '(data.status_code ?? 0) > 0' })
  node('sub_tech', 'whatweb', 5, 7, { target: sub })
  node('sub_shot', 'screenshot', 5, 8, { target: sub })
  node('sub_exposures', 'nuclei', 5, 9, { target: sub, ...exposures })
  node('find_sub_exposures', 'save_to_finding', 6, 9, finding({ target: sub }))
  edge('subs', 'each_sub')
  edge('each_sub', 'sub_http')
  edge('sub_http', 'if_live')
  for (const id of ['sub_tech', 'sub_shot', 'sub_exposures']) edge('if_live', id, 'true')
  edge('sub_exposures', 'find_sub_exposures')

  return { nodes, edges }
}

/**
 * The workflows a fresh install starts with, so the list is not empty on day
 * one. All are built from bundled nodes that write their own targets and
 * facts, and begin at a plain start node: when one runs is an action's
 * business (the shipped default action runs Domain recon on every new in-scope
 * domain, once switched on). Ids are stable so a re-seed (two engines opening
 * at once) can never write a second copy.
 */
export const STARTER_WORKFLOWS: readonly StarterWorkflow[] = [
  {
    id: 'starter-domain-recon',
    name: 'Domain recon',
    graph: fanOut({ id: 'trigger', type: 'manual', data: {} }, [
      { id: 'whois', type: 'whois' },
      { id: 'dns_a', type: 'dig', data: { record_type: 'A' } },
      { id: 'subdomains', type: 'subfinder' },
      { id: 'http_probe', type: 'httpx' },
    ]),
  },
  {
    id: 'starter-host-scan',
    name: 'Host scan',
    graph: fanOut({ id: 'trigger', type: 'manual', data: {} }, [
      { id: 'whois', type: 'whois' },
      { id: 'ports', type: 'nmap', data: { ports: '1-1000', scan_type: '-sV', timing: '-T4' } },
    ]),
  },
  { id: 'starter-recon', name: 'Recon', graph: reconGraph() },
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
