import type { RunSummary } from '../api/executions.js'

const count = (n: number, noun: string, verb: string): string => `${n} ${noun}${n === 1 ? '' : 's'} ${verb}`

/** The toast for a finished run; a null summary means it could not be fetched. */
export function runSummaryMessage(status: string | undefined, summary: RunSummary | null): string {
  if (status === 'failed') return 'Run failed. See the nodes for details.'
  if (summary === null) return 'Run finished'
  return `Run finished · ${count(summary.findings, 'finding', 'saved')} · ${count(summary.targets, 'target', 'updated')}`
}
