import type { JSX } from 'react'
import { FileText, Plus, RefreshCw } from 'lucide-react'
import { STATUSES, statusLabel } from '../../api/findings.js'
import { Button } from '../../components/ui/button.js'
import { PageToolbar } from '../../components/ui/page.js'
import type { SelectOption } from '../../components/ui/select.js'
import { Spinner } from '../../components/ui/spinner.js'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.js'
import { PillSelect } from './PillSelect.js'
import { FindingsSearch } from './FindingsSearch.js'

const statusFilterOptions: SelectOption[] = [
  { value: 'all', label: 'All statuses' },
  ...STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
]

/**
 * The Findings page toolbar: the count, the search, the status filter as a pill menu, and the
 * page actions. Each action that waits on the engine shows a spinner and locks
 * until it lands, so a second click cannot queue the same request twice.
 */
export function FindingsToolbar({
  count,
  query,
  onQueryChange,
  statusFilter,
  loading,
  exporting,
  creating,
  onStatusFilterChange,
  onRefresh,
  onExport,
  onCreate,
}: {
  /** The number of findings, or "N of M" while a search narrows the list. */
  count: string
  query: string
  onQueryChange: (query: string) => void
  /** A status value, or "all". */
  statusFilter: string
  loading: boolean
  exporting: boolean
  creating: boolean
  onStatusFilterChange: (status: string) => void
  onRefresh: () => void
  onExport: () => void
  onCreate: () => void
}): JSX.Element {
  return (
    <PageToolbar
      title="Findings"
      meta={<span className="flex h-5 items-center rounded-control bg-glass-strong px-2 text-[11px] text-foreground">{count}</span>}
      actions={
        <>
          <FindingsSearch query={query} onQueryChange={onQueryChange} />
          <PillSelect
            ariaLabel="Filter by status"
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={statusFilterOptions}
            className="h-8 px-3.5 text-[13px] font-medium shadow-glass hover:bg-glass-active"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="glass" size="icon-sm" aria-label="Refresh findings" disabled={loading} onClick={onRefresh}>
                {loading ? <Spinner /> : <RefreshCw className="size-4" strokeWidth={1.75} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Button variant="glass" size="sm" data-tour="findings-export" disabled={exporting} onClick={onExport}>
            {exporting ? <Spinner size="sm" /> : <FileText className="size-3.5" strokeWidth={2} />}
            Export report
          </Button>
          <Button size="sm" data-tour="findings-new" disabled={creating} onClick={onCreate}>
            {creating ? <Spinner size="sm" /> : <Plus className="size-3.5" strokeWidth={2} />}
            New finding
          </Button>
        </>
      }
    />
  )
}
