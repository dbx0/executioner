import { describe, expect, it } from 'vitest'
import {
  actionInputFrom,
  formProblem,
  intervalText,
  kindLabel,
  kindWithArticle,
  runsOnText,
  secondsFrom,
  sentenceFor,
  splitInterval,
  suggestionsFor,
  type ActionForm,
} from './actions.js'

const form = (over: Partial<ActionForm> = {}): ActionForm => ({
  trigger: 'on_create',
  targetKind: 'subdomain',
  inScopeOnly: true,
  every: '24',
  unit: 'hours',
  targetId: '',
  runs: 'workflow',
  workflowId: 'wf-1',
  nodeType: '',
  nodeParams: {},
  backendProfileId: 'default',
  scope: 'default',
  ...over,
})

describe('intervalText', () => {
  it('reads a whole number of the largest unit that fits', () => {
    expect(intervalText(86_400)).toBe('Every 24 hours')
    expect(intervalText(3_600)).toBe('Every hour')
    expect(intervalText(172_800)).toBe('Every 2 days')
    expect(intervalText(900)).toBe('Every 15 minutes')
  })

  it('falls back to seconds for an interval no larger unit divides', () => {
    expect(intervalText(45)).toBe('Every 45 seconds')
    expect(intervalText(null)).toBe('On a schedule')
  })
})

describe('interval form fields', () => {
  it('turns an amount and a unit into seconds, and back', () => {
    expect(secondsFrom('24', 'hours')).toBe(86_400)
    expect(splitInterval(86_400)).toEqual({ every: '24', unit: 'hours' })
    expect(splitInterval(604_800)).toEqual({ every: '7', unit: 'days' })
    expect(splitInterval(90)).toEqual({ every: '90', unit: 'seconds' })
  })

  it('reads a blank or non-numeric amount as no interval', () => {
    expect(secondsFrom('', 'hours')).toBe(0)
    expect(secondsFrom('soon', 'hours')).toBe(0)
  })
})

describe('actionInputFrom', () => {
  it('sends a default that runs a workflow when a kind of target is added', () => {
    expect(actionInputFrom(form())).toEqual({
      scope: 'default',
      kind: 'on_create',
      targetKind: 'subdomain',
      inScopeOnly: true,
      workflowId: 'wf-1',
    })
  })

  it('sends a tool with its options, and the backend only when one was picked', () => {
    const body = actionInputFrom(form({ runs: 'tool', nodeType: 'httpx', nodeParams: { rate_limit: 1 }, backendProfileId: 'kali', scope: 'engagement' }))
    expect(body).toMatchObject({ scope: 'engagement', nodeType: 'httpx', nodeParams: { rate_limit: 1 }, backendProfileId: 'kali' })
    expect(body).not.toHaveProperty('workflowId')
  })

  it('always files a scheduled action under this engagement, with its target', () => {
    const body = actionInputFrom(form({ trigger: 'interval', scope: 'default', targetId: 't1' }))
    expect(body).toMatchObject({ scope: 'engagement', kind: 'interval', intervalSeconds: 86_400, targetId: 't1' })
    expect(body).not.toHaveProperty('targetKind')
    expect(body).not.toHaveProperty('inScopeOnly')
  })
})

describe('formProblem', () => {
  it('is silent for a complete form', () => {
    expect(formProblem(form())).toBeNull()
  })

  it('asks for what is missing, one thing at a time', () => {
    expect(formProblem(form({ workflowId: '' }))).toMatch(/workflow/i)
    expect(formProblem(form({ runs: 'tool', nodeType: '' }))).toMatch(/tool/i)
    expect(formProblem(form({ trigger: 'interval', every: '0' }))).toMatch(/how often/i)
    expect(formProblem(form({ trigger: 'interval', runs: 'tool', nodeType: 'httpx', targetId: '' }))).toMatch(/target/i)
  })
})

describe('sentenceFor', () => {
  it('says the whole action in one line', () => {
    expect(sentenceFor(form(), { runName: 'Host scan', targetName: '', backendName: '', engagementName: 'Acme' })).toBe(
      'When a Subdomain in scope is added to any engagement, run the workflow Host scan on it.',
    )
    expect(
      sentenceFor(form({ trigger: 'interval', runs: 'tool', nodeType: 'tls_cert', targetId: 't1', backendProfileId: 'kali' }), {
        runName: 'TLS Certificate',
        targetName: 'acme.com',
        backendName: 'kali',
        engagementName: 'Acme',
      }),
    ).toBe('Every 24 hours in Acme, run the tool TLS Certificate on acme.com, on kali.')
  })
})

describe('target kind names', () => {
  it('capitalises a kind, and writes the acronyms in capitals', () => {
    expect(['domain', 'subdomain', 'ip', 'cidr', 'url'].map(kindLabel)).toEqual(['Domain', 'Subdomain', 'IP', 'CIDR', 'URL'])
  })

  it('picks the article by how the name is said, not by its first letter', () => {
    expect(kindWithArticle('ip')).toBe('an IP')
    expect(kindWithArticle('url')).toBe('a URL')
    expect(kindWithArticle('domain')).toBe('a Domain')
  })

  it('passes a kind it does not know through capitalised', () => {
    expect(kindLabel('asn')).toBe('Asn')
  })
})

describe('runsOnText', () => {
  it('names where an action runs', () => {
    expect(runsOnText(null, [])).toBe("on the engagement's default backend")
    expect(runsOnText('local', [])).toBe('on this machine')
    expect(runsOnText('b1', [{ id: 'b1', name: 'kali' }])).toBe('on kali')
    expect(runsOnText('gone', [])).toBe('on a backend that no longer exists')
  })
})

describe('suggestionsFor', () => {
  const everything = {
    workflowIds: ['starter-domain-recon', 'starter-host-scan', 'starter-recon'],
    toolTypes: ['httpx', 'tls_cert'],
    existing: [],
  }
  const ids = (input: Parameters<typeof suggestionsFor>[0]): string[] => suggestionsFor(input).map((s) => s.id)

  it('offers a starting point for each trigger when nothing is set up', () => {
    expect(ids(everything)).toEqual(['new-domain', 'new-ip', 'new-subdomain', 'daily-certificate', 'weekly-recon'])
  })

  it('prefills the form, so setting one up is a review and a click', () => {
    const byId = Object.fromEntries(suggestionsFor(everything).map((s) => [s.id, s.form]))
    expect(byId['new-subdomain']).toMatchObject({ trigger: 'on_create', targetKind: 'subdomain', runs: 'tool', nodeType: 'httpx', scope: 'default' })
    expect(byId['weekly-recon']).toMatchObject({ trigger: 'interval', every: '7', unit: 'days', runs: 'workflow', workflowId: 'starter-recon' })
  })

  it('leaves out a suggestion whose workflow or tool is not there to run', () => {
    expect(ids({ ...everything, workflowIds: [], toolTypes: ['httpx'] })).toEqual(['new-subdomain'])
  })

  it('leaves out a suggestion an existing action already covers, switched on or not', () => {
    const existing = [
      { kind: 'on_create' as const, targetKind: 'domain', workflowId: 'starter-domain-recon', nodeType: null },
      { kind: 'interval' as const, targetKind: null, workflowId: null, nodeType: 'tls_cert' },
    ]
    expect(ids({ ...everything, existing })).toEqual(['new-ip', 'new-subdomain', 'weekly-recon'])
  })
})
