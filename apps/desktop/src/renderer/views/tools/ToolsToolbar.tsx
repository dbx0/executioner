import type { JSX } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/button.js'
import { PageToolbar } from '../../components/ui/page.js'
import { Spinner } from '../../components/ui/spinner.js'
import { Tip } from '../../components/ui/tip.js'
import type { BackendProfile } from '../../api/backends.js'
import { ConnectionPicker } from './ConnectionPicker.js'
import type { InstallStatus } from './use-install-state.js'

/**
 * The page toolbar: the tool count, then where tools run. The connection sits
 * here because it is page-wide: the catalog's install marks and every run
 * started from the form both follow it.
 */
export function ToolsToolbar({
  count,
  install,
  profiles,
  backendId,
  onBackend,
}: {
  /** How many tools the catalog holds. */
  count: number
  install: InstallStatus
  profiles: BackendProfile[]
  backendId: string
  onBackend: (id: string) => void
}): JSX.Element {
  const { probe, installCounts, recheck } = install
  const checking = probe?.busy ?? false
  return (
    <PageToolbar
      title="Tools"
      meta={count}
      actions={
        <div role="toolbar" aria-label="Tools" data-tour="tools-connection" className="flex min-w-0 items-center gap-2">
          {probe?.error != null && (
            <span className="min-w-0 truncate text-[11.5px] text-muted-foreground">
              Could not check this connection, so install state is unknown.
            </span>
          )}
          {checking && (
            <span role="status" className="hidden shrink-0 text-[11.5px] text-muted-foreground min-[640px]:inline">
              Checking installed tools
            </span>
          )}
          {installCounts.installed + installCounts.missing > 0 && (
            <span className="hidden shrink-0 text-[11.5px] text-muted-foreground min-[640px]:inline">
              <span className="text-status-success">{installCounts.installed} installed</span>
              {installCounts.missing > 0 && (
                <>
                  {' · '}
                  <span className="text-destructive">{installCounts.missing} missing</span>
                </>
              )}
            </span>
          )}
          <Tip label="Recheck installed tools">
            <Button
              variant="glass"
              size="icon-sm"
              aria-label="Recheck installed tools"
              disabled={checking}
              onClick={recheck}
            >
              {checking ? <Spinner size="sm" /> : <RefreshCw className="size-3.5" />}
            </Button>
          </Tip>
          <ConnectionPicker profiles={profiles} value={backendId} onChange={onBackend} />
        </div>
      }
    />
  )
}
