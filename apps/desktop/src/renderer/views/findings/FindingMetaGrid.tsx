import type { JSX } from 'react'
import type { Finding } from '../../api/findings.js'

/**
 * The facts about a finding nobody edits, as the card's footer: what recorded
 * it, when it was first and last seen, and where its evidence file lives. The
 * asset it is on sits in the triage row instead.
 */
export function FindingMetaGrid({ finding }: { finding: Finding }): JSX.Element {
  return (
    <dl className="grid min-w-0 grid-cols-[110px_minmax(0,1fr)] gap-y-2.5 border-t border-glass-border pt-4 text-xs [&>dt]:text-tertiary-foreground">
      <dt>Recorded by</dt>
      <dd className="min-w-0 break-words">
        {finding.source === 'workflow' && finding.nodeId !== null ? `workflow node ${finding.nodeId}` : finding.source}
        {finding.executionId !== null && <span className="font-mono"> · run {finding.executionId.slice(0, 8)}</span>}
      </dd>
      <dt>First seen</dt>
      <dd>{new Date(finding.createdAt).toLocaleString()}</dd>
      <dt>Last seen</dt>
      <dd>{new Date(finding.updatedAt).toLocaleString()}</dd>
      {finding.evidencePath !== null && (
        <>
          <dt>Evidence</dt>
          <dd className="break-all font-mono">{finding.evidencePath}</dd>
        </>
      )}
    </dl>
  )
}
