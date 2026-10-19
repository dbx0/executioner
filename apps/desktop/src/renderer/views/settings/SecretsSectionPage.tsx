import type { JSX } from 'react'
import { useApp } from '../../store.js'
import { SecretsSection } from '../../components/SecretsSection.js'
import { PageHeading } from './parts.js'

/** Secrets: the API-key providers for the recon integrations. */
export function SecretsSectionPage(): JSX.Element {
  const client = useApp((s) => s.client)
  return (
    <div>
      <PageHeading title="Secrets" description="API keys for the recon integrations. Saved for you, not for one engagement." />
      {client === null ? (
        <p className="text-xs text-muted-foreground">Open an engagement to manage secrets.</p>
      ) : (
        <SecretsSection client={client} />
      )}
    </div>
  )
}
