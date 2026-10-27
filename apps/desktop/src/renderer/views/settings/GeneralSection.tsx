import type { JSX } from 'react'
import { Compass, Sparkles } from 'lucide-react'
import { useApp } from '../../store.js'
import { Button } from '../../components/ui/button.js'
import { OnboardingChecklist } from '../../components/onboarding/OnboardingChecklist.js'
import { Switch } from '../../components/ui/switch.js'
import { PageHeading, Row } from './parts.js'

/** General: how the app behaves while you work. The engagement's own identity
 *  (name, badge) and closing it live on the About page, with the engagement. */
export function GeneralSection(): JSX.Element {
  const openOnboarding = useApp((s) => s.openOnboarding)
  const resetTours = useApp((s) => s.resetTours)
  const toursSeen = useApp((s) => s.toursSeen.length)
  const editorAutoSave = useApp((s) => s.editorAutoSave)
  const setEditorAutoSave = useApp((s) => s.setEditorAutoSave)

  return (
    <div>
      <PageHeading title="General" description="How the app behaves while you work." />

      <div className="mb-4">
        <OnboardingChecklist embedded />
      </div>

      <Row
        label="Autosave edited files"
        description="Writes changes automatically after a short pause. Suspended while a file has changed on disk."
      >
        <Switch
          checked={editorAutoSave}
          onCheckedChange={setEditorAutoSave}
          aria-label="Autosave edited files"
        />
      </Row>
      <Row label="Setup guide" description="Re-run the first-launch onboarding (agent, theme, execution).">
        <Button variant="outline" size="sm" onClick={openOnboarding}>
          <Sparkles className="size-4" strokeWidth={1.75} />
          Run setup
        </Button>
      </Row>
      <Row label="Page tours" description="Show each page's walkthrough again the next time you open it.">
        <Button variant="outline" size="sm" disabled={toursSeen === 0} onClick={resetTours}>
          <Compass className="size-4" strokeWidth={1.75} />
          Replay tours
        </Button>
      </Row>
    </div>
  )
}
