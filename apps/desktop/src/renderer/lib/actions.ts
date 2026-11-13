import type { ActionInput, ActionKind, ActionScope } from '../api/actions.js'

/**
 * The built-in nodes an action may run on their own, next to the tools. Mirrors
 * the engine's STANDALONE_BUILTIN_NODES: the ones that make sense aimed at a
 * single target, with no canvas around them.
 */
export const STANDALONE_BUILTIN_NODES = ['tls_cert', 'dns_records', 'asn', 'cloud_buckets', 'screenshot', 'geoip', 'shodan', 'censys']

export const TARGET_KINDS = ['domain', 'subdomain', 'ip', 'cidr', 'url'] as const

/** How each kind is written for a reader. The stored value stays lower case. */
const KIND_LABELS: Record<string, string> = { domain: 'Domain', subdomain: 'Subdomain', ip: 'IP', cidr: 'CIDR', url: 'URL' }

/** A target kind as a label: capitalised, with the acronyms in capitals. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** "an IP", "a URL": the article follows how the name is said, not its first letter. */
export function kindWithArticle(kind: string): string {
  return `${kind === 'ip' ? 'an' : 'a'} ${kindLabel(kind)}`
}

/** "Follow the engagement default": Radix Select forbids an empty item value. */
export const DEFAULT_BACKEND = 'default'
/** Pins an action to this machine even when the engagement default is remote. */
export const LOCAL_BACKEND = 'local'

export type IntervalUnit = 'seconds' | 'minutes' | 'hours' | 'days'

const UNIT_SECONDS: Record<IntervalUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86_400 }
/** Largest first, so an interval reads in the biggest unit that divides it. */
const UNITS_DESC: IntervalUnit[] = ['days', 'hours', 'minutes', 'seconds']
export const INTERVAL_UNITS: IntervalUnit[] = ['minutes', 'hours', 'days']

/** What the New action panel holds while it is being filled in. */
export interface ActionForm {
  trigger: ActionKind
  targetKind: string
  inScopeOnly: boolean
  every: string
  unit: IntervalUnit
  targetId: string
  runs: 'workflow' | 'tool'
  workflowId: string
  nodeType: string
  nodeParams: Record<string, unknown>
  backendProfileId: string
  scope: ActionScope
}

export const EMPTY_FORM: ActionForm = {
  trigger: 'on_create',
  targetKind: 'domain',
  inScopeOnly: true,
  every: '24',
  unit: 'hours',
  targetId: '',
  runs: 'workflow',
  workflowId: '',
  nodeType: '',
  nodeParams: {},
  backendProfileId: DEFAULT_BACKEND,
  scope: 'engagement',
}

export function secondsFrom(every: string, unit: IntervalUnit): number {
  const amount = Number(every)
  return Number.isFinite(amount) && amount > 0 ? Math.floor(amount * UNIT_SECONDS[unit]) : 0
}

/** The amount and unit an interval reads best in: 86400 is "24 hours", not "1 day". */
export function splitInterval(seconds: number): { every: string; unit: IntervalUnit } {
  // A single day reads better as 24 hours on a form that offers both.
  if (seconds === UNIT_SECONDS.days) return { every: '24', unit: 'hours' }
  for (const unit of UNITS_DESC) {
    if (seconds >= UNIT_SECONDS[unit] && seconds % UNIT_SECONDS[unit] === 0) {
      return { every: String(seconds / UNIT_SECONDS[unit]), unit }
    }
  }
  return { every: String(seconds), unit: 'seconds' }
}

export function intervalText(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return 'On a schedule'
  const { every, unit } = splitInterval(seconds)
  return every === '1' ? `Every ${unit.slice(0, -1)}` : `Every ${every} ${unit}`
}

/** A scheduled action has no target kind to hand it a target, so it belongs to one engagement. */
export const scopeOf = (form: ActionForm): ActionScope => (form.trigger === 'interval' ? 'engagement' : form.scope)

export function actionInputFrom(form: ActionForm): ActionInput {
  const body: ActionInput = { scope: scopeOf(form), kind: form.trigger }
  if (form.trigger === 'interval') {
    body.intervalSeconds = secondsFrom(form.every, form.unit)
    if (form.targetId !== '') body.targetId = form.targetId
  } else {
    body.targetKind = form.targetKind
    body.inScopeOnly = form.inScopeOnly
  }
  if (form.runs === 'workflow') body.workflowId = form.workflowId
  else {
    body.nodeType = form.nodeType
    body.nodeParams = form.nodeParams
  }
  // The default sentinel is left off, so the engine falls back to the
  // engagement default when the action fires. "local" is sent as is.
  if (form.backendProfileId !== '' && form.backendProfileId !== DEFAULT_BACKEND) body.backendProfileId = form.backendProfileId
  return body
}

/** The first thing the form still needs, in words, or null when it can be saved. */
export function formProblem(form: ActionForm): string | null {
  if (form.runs === 'workflow' && form.workflowId === '') return 'Pick the workflow to run.'
  if (form.runs === 'tool' && form.nodeType === '') return 'Pick the tool to run.'
  if (form.trigger === 'interval') {
    if (secondsFrom(form.every, form.unit) <= 0) return 'Say how often it should run.'
    if (form.runs === 'tool' && form.targetId === '') return 'Pick the target the tool runs against.'
  }
  return null
}

export function runsOnText(backendProfileId: string | null, backends: Array<{ id: string; name: string }>): string {
  if (backendProfileId === null) return "on the engagement's default backend"
  if (backendProfileId === LOCAL_BACKEND) return 'on this machine'
  const backend = backends.find((b) => b.id === backendProfileId)
  return backend === undefined ? 'on a backend that no longer exists' : `on ${backend.name}`
}

/** The whole action as one sentence, shown before it is created. */
export function sentenceFor(
  form: ActionForm,
  names: { runName: string; targetName: string; backendName: string; engagementName: string },
): string {
  const what = `run the ${form.runs === 'workflow' ? 'workflow' : 'tool'} ${names.runName === '' ? '...' : names.runName}`
  const where = form.backendProfileId === DEFAULT_BACKEND || form.backendProfileId === '' ? '' : `, on ${names.backendName}`
  if (form.trigger === 'interval') {
    const on = names.targetName === '' ? '' : ` on ${names.targetName}`
    return `${intervalText(secondsFrom(form.every, form.unit))} in ${names.engagementName}, ${what}${on}${where}.`
  }
  const scoped = form.inScopeOnly ? ' in scope' : ''
  const place = scopeOf(form) === 'default' ? 'any engagement' : names.engagementName
  return `When ${kindWithArticle(form.targetKind)}${scoped} is added to ${place}, ${what} on it${where}.`
}

/** A ready-made action the page offers, as a prefilled form to review. */
export interface ActionSuggestion {
  id: string
  title: string
  body: string
  form: Partial<ActionForm>
}

/** What an existing action is, as far as "is this suggestion already set up" goes. */
export interface ExistingAction {
  kind: ActionKind
  targetKind: string | null
  workflowId: string | null
  nodeType: string | null
}

const ALL_SUGGESTIONS: ActionSuggestion[] = [
  {
    id: 'new-domain',
    title: 'Recon every new domain',
    body: 'When a Domain in scope is added, look up its WHOIS and DNS, list its subdomains and probe it over HTTP.',
    form: { trigger: 'on_create', targetKind: 'domain', inScopeOnly: true, runs: 'workflow', workflowId: 'starter-domain-recon', scope: 'default' },
  },
  {
    id: 'new-ip',
    title: 'Scan every new IP',
    body: 'When an IP in scope is added, look up who owns it and scan its first thousand ports.',
    form: { trigger: 'on_create', targetKind: 'ip', inScopeOnly: true, runs: 'workflow', workflowId: 'starter-host-scan', scope: 'default' },
  },
  {
    id: 'new-subdomain',
    title: 'Probe every new subdomain',
    body: 'When a Subdomain in scope is added, check whether it answers over HTTP and keep its title and certificate.',
    form: { trigger: 'on_create', targetKind: 'subdomain', inScopeOnly: true, runs: 'tool', nodeType: 'httpx', scope: 'default' },
  },
  {
    id: 'daily-certificate',
    title: 'Check a certificate every day',
    body: 'Read the certificate one of your targets serves once a day, so an expiry or a change does not go unseen.',
    form: { trigger: 'interval', every: '24', unit: 'hours', runs: 'tool', nodeType: 'tls_cert', scope: 'engagement' },
  },
  {
    id: 'weekly-recon',
    title: 'Run the full recon every week',
    body: 'Go over a domain and its subdomains again once a week, to catch what appeared since the last pass.',
    form: { trigger: 'interval', every: '7', unit: 'days', runs: 'workflow', workflowId: 'starter-recon', scope: 'engagement' },
  },
]

/**
 * The suggestions worth showing: the ones whose workflow or tool exists here,
 * and that no action already covers. An action that is merely switched off
 * still covers its suggestion; the thing to do there is turn it on.
 */
export function suggestionsFor(input: { workflowIds: string[]; toolTypes: string[]; existing: ExistingAction[] }): ActionSuggestion[] {
  return ALL_SUGGESTIONS.filter(({ form }) => {
    const runnable = form.runs === 'workflow' ? input.workflowIds.includes(form.workflowId ?? '') : input.toolTypes.includes(form.nodeType ?? '')
    if (!runnable) return false
    return !input.existing.some(
      (action) =>
        action.kind === form.trigger &&
        (form.trigger === 'interval' || action.targetKind === form.targetKind) &&
        (form.runs === 'workflow' ? action.workflowId === form.workflowId : action.nodeType === form.nodeType),
    )
  })
}

