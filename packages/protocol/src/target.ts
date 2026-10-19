import { z } from 'zod'

export const TargetKind = {
  Domain: 'domain',
  Subdomain: 'subdomain',
  Ip: 'ip',
  Cidr: 'cidr',
  Url: 'url',
} as const

export type TargetKind = (typeof TargetKind)[keyof typeof TargetKind]

export const targetKindSchema = z.enum(['domain', 'subdomain', 'ip', 'cidr', 'url'])

/**
 * Where an asset stands against the engagement's boundary. `unknown` is a
 * distinct state from `out` on purpose: nobody having mentioned a host is a
 * question for the operator, not a decision to keep away from it.
 */
export const scopeStatusSchema = z.enum(['in', 'out', 'unknown'])
export type ScopeStatus = z.infer<typeof scopeStatusSchema>

const HOSTNAME_KINDS = new Set<string>(['domain', 'subdomain'])

/**
 * Canonical form used for deduplication. Hostnames are case insensitive and a
 * trailing dot is the same name, so both are folded away before storage.
 */
export function normaliseTargetValue(kind: string, value: string): string {
  const trimmed = value.trim()
  if (!HOSTNAME_KINDS.has(kind)) return trimmed
  return trimmed.toLowerCase().replace(/\.$/, '')
}

export const targetSchema = z.object({
  id: z.string().uuid(),
  /** Derived from the value, never taken from the caller. */
  kind: targetKindSchema,
  value: z.string().min(1),
  /** Registrable domain the asset sits under; null for an ip or a network. */
  apex: z.string().nullable().default(null),
  parentId: z.string().uuid().nullable(),
  source: z.string().min(1),
  /** Verdict against the engagement's scope rules at the last write. */
  scopeStatus: scopeStatusSchema.default('unknown'),
  /** Why it got that verdict, in words, for the badge tooltip. */
  scopeReason: z.string().default(''),
  firstSeen: z.string().datetime(),
  lastSeen: z.string().datetime(),
})

export type Target = z.infer<typeof targetSchema>

export const targetFactKindSchema = z.enum([
  'port',
  'technology',
  'http_service',
  'screenshot',
  'whois',
  'vulnerability',
  'geolocation',
  'raw_output',
])

export type TargetFactKind = z.infer<typeof targetFactKindSchema>

export const targetFactSchema = z.object({
  id: z.string().uuid(),
  targetId: z.string().uuid(),
  kind: targetFactKindSchema,
  executionId: z.string().uuid().nullable(),
  nodeId: z.string().nullable(),
  collectedAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()),
})

export type TargetFact = z.infer<typeof targetFactSchema>
