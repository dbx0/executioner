import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Finding } from '@exe/db'
import type { Project } from '@exe/project'

/** Where a generated report lands, relative to the engagement root. */
export const REPORT_DIR = 'reports'

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  confirmed: 'Confirmed',
  false_positive: 'False positive',
  discarded: 'Discarded',
  fixed: 'Fixed',
}

/** `findings-2026-09-10-1432.md` — sortable, and readable at a glance. */
export function reportFilename(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `findings-${String(now.getFullYear())}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.md`
}

/** "2 critical, 1 high" — the counts, worst first, skipping what isn't there. */
function severityBreakdown(findings: readonly Finding[]): string {
  const counts = new Map<string, number>()
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) ?? 0) + 1)
  const parts = SEVERITY_ORDER.filter((s) => counts.has(s)).map((s) => `${String(counts.get(s))} ${s}`)
  return parts.length === 0 ? 'none' : parts.join(', ')
}

/** A finding's target, by value rather than by id. */
function targetValues(project: Project): Map<string, string> {
  return new Map(project.targets.all().map((t) => [t.id, t.value]))
}

/**
 * Whether `details` was written as Markdown and can go into the report as-is.
 *
 * Agents are instructed to format findings, but a `save_to_finding` node still
 * files a raw row or a pasted response, and that has to keep its fence or the
 * report turns it into one run-on paragraph. A fence, heading, list, table or
 * bold run is enough to tell the two apart — and re-fencing text that already
 * carries a fence would break the block anyway.
 */
function looksLikeMarkdown(details: string): boolean {
  return /^\s*(?:```|#{1,6} |[-*+] |\d+\. |> |\|)/m.test(details) || /\*\*\S/.test(details)
}

/**
 * Render the findings as a Markdown report: a summary, then one section per
 * finding in the order the list shows them (worst first).
 *
 * This is a working document, not a submission — it is the engagement's state
 * written down so it can be read outside the app, pasted into a report, or
 * committed. Agents are told to write `description` and `details` as Markdown,
 * so both go in verbatim; only evidence that is plainly not Markdown — a
 * workflow node's raw row, a pasted response — is fenced on the way out.
 */
export function renderFindingsReport(
  project: Project,
  findings: readonly Finding[],
  options: { generatedAt: Date; filterNote?: string },
): string {
  const values = targetValues(project)
  const lines: string[] = [
    `# Findings — ${project.config.name}`,
    '',
    `Generated ${options.generatedAt.toISOString()} · ${String(findings.length)} finding${findings.length === 1 ? '' : 's'} (${severityBreakdown(findings)})`,
  ]
  if (options.filterNote !== undefined && options.filterNote !== '') {
    lines.push('', `_Filtered: ${options.filterNote}._`)
  }

  if (findings.length === 0) {
    lines.push('', 'Nothing recorded yet.', '')
    return lines.join('\n')
  }

  for (const f of findings) {
    const target = f.targetId === null ? '—' : (values.get(f.targetId) ?? f.targetId)
    const recordedBy =
      f.source === 'workflow' && f.nodeId !== null ? `workflow node \`${f.nodeId}\`` : f.source
    lines.push(
      '',
      '---',
      '',
      `## [${f.severity.toUpperCase()}] ${f.title}`,
      '',
      `**Status:** ${STATUS_LABELS[f.status] ?? f.status}  `,
      `**Target:** ${target}  `,
      `**Recorded by:** ${recordedBy}${f.executionId === null ? '' : ` (run \`${f.executionId}\`)`}  `,
      `**First seen:** ${f.createdAt}  `,
      `**Last seen:** ${f.updatedAt}`,
    )
    if (f.description.trim() !== '') lines.push('', f.description.trim())
    const details = f.details.trim()
    if (details !== '') lines.push('', looksLikeMarkdown(details) ? details : ['```', details, '```'].join('\n'))
    if (f.evidencePath !== null && f.evidencePath !== '') lines.push('', `Evidence: \`${f.evidencePath}\``)
  }

  lines.push('')
  return lines.join('\n')
}

export interface WrittenReport {
  /** Absolute path of the file written. */
  path: string
  /** Engagement-relative path, which is what the UI shows. */
  relativePath: string
  count: number
}

/** Render and write the report into `<root>/reports/`, creating it if needed. */
export function writeFindingsReport(
  project: Project,
  findings: readonly Finding[],
  options: { generatedAt?: Date; filterNote?: string } = {},
): WrittenReport {
  const generatedAt = options.generatedAt ?? new Date()
  const dir = join(project.root, REPORT_DIR)
  mkdirSync(dir, { recursive: true })
  const name = reportFilename(generatedAt)
  const path = join(dir, name)
  writeFileSync(
    path,
    renderFindingsReport(project, findings, {
      generatedAt,
      ...(options.filterNote === undefined ? {} : { filterNote: options.filterNote }),
    }),
    'utf8',
  )
  return { path, relativePath: `${REPORT_DIR}/${name}`, count: findings.length }
}
