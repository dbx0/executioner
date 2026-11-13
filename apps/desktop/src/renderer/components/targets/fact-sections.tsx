/**
 * Barrel for the per-fact-kind renderers plus the registry that maps a fact
 * kind onto its section label, order and component. The presentational pieces
 * live in `./fact-sections/`; everything they used to export from this module
 * is re-exported here so importers keep the same specifier.
 */
import type { JSX } from 'react'
import type { TargetFact } from '../../api/targets.js'
import { CertificateFacts } from './fact-sections/CertificateFacts.js'
import { DnsRecordFacts } from './fact-sections/DnsRecordFacts.js'
import { GeolocationFacts } from './fact-sections/GeolocationFacts.js'
import { HttpServiceFacts } from './fact-sections/HttpServiceFacts.js'
import { PortFacts } from './fact-sections/PortFacts.js'
import { RawOutputFacts } from './fact-sections/RawOutputFacts.js'
import { TechnologyFacts } from './fact-sections/TechnologyFacts.js'
import { VulnerabilityFacts } from './fact-sections/VulnerabilityFacts.js'
import { WhoisFacts } from './fact-sections/WhoisFacts.js'

export { formatDate, RecordMeta, Section, str } from './fact-sections/primitives.js'
export {
  CertificateFacts,
  DnsRecordFacts,
  GeolocationFacts,
  HttpServiceFacts,
  PortFacts,
  RawOutputFacts,
  TechnologyFacts,
  VulnerabilityFacts,
  WhoisFacts,
}

// ---------------------------------------------------------------------------
// Renderer registry
// ---------------------------------------------------------------------------

export const FACT_KIND_LABELS: Record<string, string> = {
  port: 'Ports',
  technology: 'Technologies',
  http_service: 'HTTP Services',
  certificate: 'Certificates',
  dns_record: 'DNS Records',
  whois: 'WHOIS',
  vulnerability: 'Vulnerabilities',
  geolocation: 'Geolocation',
  raw_output: 'Raw Output',
}

/** Ordered list of fact kinds rendered as their own Section (screenshots handled separately). */
export const FACT_KIND_ORDER = [
  'port',
  'technology',
  'http_service',
  'certificate',
  'dns_record',
  'whois',
  'vulnerability',
  'geolocation',
  'raw_output',
] as const

export const FACT_RENDERERS: Record<string, (props: { facts: TargetFact[] }) => JSX.Element> = {
  port: PortFacts,
  technology: TechnologyFacts,
  http_service: HttpServiceFacts,
  certificate: CertificateFacts,
  dns_record: DnsRecordFacts,
  whois: WhoisFacts,
  vulnerability: VulnerabilityFacts,
  geolocation: GeolocationFacts,
  raw_output: RawOutputFacts,
}
