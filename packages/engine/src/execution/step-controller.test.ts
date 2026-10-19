import { describe, expect, it } from 'vitest'
import { StepController } from './step-controller.js'

describe('StepController', () => {
  it('step releases exactly one waiting gate', async () => {
    const steps = new StepController()
    steps.register('e1')

    let aDone = false
    let bDone = false
    const a = steps.gate('e1', 'a').then(() => {
      aDone = true
    })
    const b = steps.gate('e1', 'b').then(() => {
      bDone = true
    })

    // Nothing released yet.
    await Promise.resolve()
    expect(aDone).toBe(false)
    expect(bDone).toBe(false)

    steps.step('e1')
    await a
    expect(aDone).toBe(true)
    // The second gate is still waiting.
    await Promise.resolve()
    expect(bDone).toBe(false)

    steps.step('e1')
    await b
    expect(bDone).toBe(true)
  })

  it('a banked permit satisfies the next gate immediately', async () => {
    const steps = new StepController()
    steps.register('e2')

    // Step with no waiter banks a permit.
    steps.step('e2')

    let done = false
    await steps.gate('e2', 'a').then(() => {
      done = true
    })
    expect(done).toBe(true)

    // The permit was consumed; a second gate now blocks.
    let secondDone = false
    void steps.gate('e2', 'b').then(() => {
      secondDone = true
    })
    await Promise.resolve()
    expect(secondDone).toBe(false)
  })

  it('resume releases all waiting gates and makes later gates non-blocking', async () => {
    const steps = new StepController()
    steps.register('e3')

    const flags = { a: false, b: false }
    const a = steps.gate('e3', 'a').then(() => {
      flags.a = true
    })
    const b = steps.gate('e3', 'b').then(() => {
      flags.b = true
    })

    await Promise.resolve()
    expect(flags).toEqual({ a: false, b: false })

    steps.resume('e3')
    await Promise.all([a, b])
    expect(flags).toEqual({ a: true, b: true })

    // A gate requested after resume resolves immediately.
    let later = false
    await steps.gate('e3', 'c').then(() => {
      later = true
    })
    expect(later).toBe(true)
  })

  it('gate on an unregistered execution resolves immediately', async () => {
    const steps = new StepController()
    let done = false
    await steps.gate('missing', 'a').then(() => {
      done = true
    })
    expect(done).toBe(true)
    expect(steps.has('missing')).toBe(false)
  })

  it('unregister drops state and makes has() false', () => {
    const steps = new StepController()
    steps.register('e4')
    expect(steps.has('e4')).toBe(true)
    steps.unregister('e4')
    expect(steps.has('e4')).toBe(false)
  })
})
