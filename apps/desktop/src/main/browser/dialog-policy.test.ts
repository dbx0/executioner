import { describe, expect, it } from 'vitest'
import { DialogPolicy } from './dialog-policy'

describe('DialogPolicy', () => {
  it('answers for the agent during a call and within 2s after', () => {
    let t = 1000
    const policy = new DialogPolicy(() => t)
    const end = policy.begin({})
    expect(policy.decide().by).toBe('agent')
    end()
    t += 1999
    expect(policy.decide().by).toBe('agent')
  })

  it('goes to the operator after the window', () => {
    let t = 1000
    const policy = new DialogPolicy(() => t)
    expect(policy.decide()).toEqual({ by: 'operator' })
    policy.begin({})()
    t += 2000
    expect(policy.decide()).toEqual({ by: 'operator' })
  })

  it("accept and promptText follow the call's choice", () => {
    const policy = new DialogPolicy(() => 0)
    const end = policy.begin({ dialog: 'accept', promptText: 'hi' })
    expect(policy.decide()).toEqual({ by: 'agent', accept: true, promptText: 'hi' })
    end()
    const end2 = policy.begin({})
    expect(policy.decide()).toEqual({ by: 'agent', accept: false, promptText: undefined })
    end2()
  })
})
