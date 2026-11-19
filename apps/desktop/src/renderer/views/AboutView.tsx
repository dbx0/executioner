import type { JSX } from 'react'
import { FolderX, RefreshCw } from 'lucide-react'
import { useApp } from '../store.js'
import { Button } from '../components/ui/button.js'
import { GlassPanel } from '../components/ui/glass-panel.js'
import { Page, PageBody, PageToolbar } from '../components/ui/page.js'
import { ScrollArea } from '../components/ui/scroll-area.js'
import { Spinner } from '../components/ui/spinner.js'
import { AboutSkeleton } from './about/AboutSkeleton.js'
import { Hint } from './about/Hint.js'
import { OverviewBody } from './about/OverviewBody.js'
import { agentActivity } from './about/summary.js'
import { useOverview } from './about/useOverview.js'

/**
 * The engagement at a glance: who it is, what has been recorded against it, and
 * where the work has not reached yet.
 *
 * Everything on the page is one `GET /project/overview` read, which is why the
 * numbers on it always agree with each other. The one exception is the agent
 * row: which sessions are working is renderer state, known here and nowhere else.
 */
export function AboutView(): JSX.Element {
  const sessions = useApp((s) => s.sessions)
  const sessionState = useApp((s) => s.sessionState)
  const subagents = useApp((s) => s.subagents)
  const setActiveView = useApp((s) => s.setActiveView)
  const setPendingTargetId = useApp((s) => s.setPendingTargetId)
  const closeEngagement = useApp((s) => s.closeEngagement)
  const { data, loading, error, refresh } = useOverview()
  // The store is the live copy of the name; the payload covers the first paint.
  const name = useApp((s) => s.engagementName) ?? data?.engagement.name

  const openTarget = (id: string): void => {
    setPendingTargetId(id)
    setActiveView('targets')
  }

  return (
    <Page>
      <PageToolbar
        title={
          name === undefined ? (
            'About'
          ) : (
            <>
              {name} <span className="font-normal text-muted-foreground">/ About</span>
            </>
          )
        }
        actions={
          <>
            <Button variant="glass" size="icon-sm" disabled={loading} onClick={refresh} aria-label="Refresh">
              {loading ? <Spinner /> : <RefreshCw strokeWidth={1.75} />}
            </Button>
            <Hint label="Return to the landing screen. The engine keeps running.">
              <Button variant="glass" size="sm" data-tour="about-close" onClick={() => closeEngagement()}>
                <FolderX strokeWidth={1.75} />
                Close engagement
              </Button>
            </Hint>
          </>
        }
      />

      {error !== null && (
        <div
          role="alert"
          className="mb-panel shrink-0 rounded-panel bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] px-4 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      <PageBody>
        <ScrollArea className="min-w-0 flex-1">
          {data !== null ? (
            <OverviewBody
              data={data}
              agents={agentActivity(sessions, sessionState, subagents)}
              onOpenTargets={() => setActiveView('targets')}
              onOpenFindings={() => setActiveView('findings')}
              onOpenTarget={openTarget}
            />
          ) : error === null ? (
            <AboutSkeleton />
          ) : (
            <GlassPanel className="flex h-full min-h-24 items-center justify-center p-4 text-[13px] text-muted-foreground">
              Nothing to show while the engine is unreachable.
            </GlassPanel>
          )}
        </ScrollArea>
      </PageBody>
    </Page>
  )
}
