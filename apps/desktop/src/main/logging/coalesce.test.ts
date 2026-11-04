import { describe, expect, it } from 'vitest'
import { coalesced } from './coalesce.js'

/** A job whose runs finish only when the test says so. */
function controllable() {
  const releases: Array<() => void> = []
  let started = 0
  const run = (): Promise<void> => {
    started += 1
    return new Promise<void>((resolve) => releases.push(resolve))
  }
  return { run, releases, started: () => started }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('coalesced', () => {
  it('runs once when nothing else is in flight', async () => {
    const job = controllable()
    const call = coalesced(job.run)
    const done = call()
    expect(job.started()).toBe(1)
    job.releases[0]?.()
    await done
    await tick()
    expect(job.started()).toBe(1)
  })

  it('runs exactly once more after the in-flight run when called during it', async () => {
    const job = controllable()
    const call = coalesced(job.run)
    void call()
    void call()
    void call()
    void call()
    expect(job.started()).toBe(1)
    job.releases[0]?.()
    await tick()
    expect(job.started()).toBe(2)
    job.releases[1]?.()
    await tick()
    expect(job.started()).toBe(2)
  })

  it('never has two runs in flight at once', async () => {
    let inFlight = 0
    let peak = 0
    const call = coalesced(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await tick()
      inFlight -= 1
    })
    void call()
    void call()
    await tick()
    void call()
    for (let i = 0; i < 10; i++) await tick()
    expect(peak).toBe(1)
  })

  it('keeps going after a failed run', async () => {
    let runs = 0
    const call = coalesced(async () => {
      runs += 1
      if (runs === 1) throw new Error('boom')
    })
    await call()
    await call()
    expect(runs).toBe(2)
  })
})
