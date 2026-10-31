import { describe, expect, it, vi } from 'vitest'
import { BrowserRegistry } from './registry.js'

describe('BrowserRegistry', () => {
  it('create publishes opened with owner null by default', () => {
    const publish = vi.fn()
    const registry = new BrowserRegistry(publish)
    const item = registry.create({ url: 'https://example.com' })
    expect(item.owner).toBeNull()
    expect(publish).toHaveBeenCalledWith('opened', item)
  })

  it("setOwner moves a session's ownership off its previous browser", () => {
    const registry = new BrowserRegistry(vi.fn())
    const a = registry.create({})
    const b = registry.create({})
    registry.setOwner(a.id, 's1')
    registry.setOwner(b.id, 's1')
    expect(registry.ownedBy('s1')?.id).toBe(b.id)
    expect(registry.get(a.id)?.owner).toBeNull()
  })

  it('remove publishes closed and forgets the item', () => {
    const publish = vi.fn()
    const registry = new BrowserRegistry(publish)
    const item = registry.create({})
    registry.remove(item.id)
    expect(publish).toHaveBeenLastCalledWith('closed', item)
    expect(registry.get(item.id)).toBeUndefined()
    expect(registry.list()).toEqual([])
  })

  describe('browserFor', () => {
    it('gives a session its own browser, else takes over a free one, else opens one', () => {
      const publish = vi.fn()
      const registry = new BrowserRegistry(publish)
      const free = registry.create({ url: 'https://x.test' })
      const taken = registry.create({ owner: 's2' })
      const first = registry.browserFor('s1')
      expect(first.id).toBe(free.id)
      expect(registry.get(free.id)?.owner).toBe('s1')
      expect(publish).toHaveBeenLastCalledWith('owner', expect.objectContaining({ id: free.id, owner: 's1' }))
      expect(registry.browserFor('s1').id).toBe(free.id)
      expect(registry.browserFor('s2').id).toBe(taken.id)
      const fresh = registry.browserFor('s3')
      expect([free.id, taken.id]).not.toContain(fresh.id)
      expect(fresh.owner).toBe('s3')
    })
  })

  describe('ask', () => {
    it('stores the pending ask on the item, publishes it, and resolves on answer', async () => {
      const publish = vi.fn()
      const registry = new BrowserRegistry(publish)
      const item = registry.create({})
      const pending = registry.ask(item.id, 'solve the captcha')
      expect(registry.get(item.id)?.ask?.message).toBe('solve the captcha')
      expect(typeof registry.get(item.id)?.ask?.askedAt).toBe('number')
      expect(publish).toHaveBeenLastCalledWith('ask', expect.objectContaining({ id: item.id }), { message: 'solve the captcha' })
      expect(registry.answer(item.id, '123456')).toBe(true)
      await expect(pending).resolves.toEqual({ answered: true, reply: '123456' })
      expect(registry.get(item.id)?.ask).toBeUndefined()
      expect(publish).toHaveBeenLastCalledWith('answered', expect.objectContaining({ id: item.id }))
    })

    it('an answer without a reply carries no reply', async () => {
      const registry = new BrowserRegistry(vi.fn())
      const item = registry.create({})
      const pending = registry.ask(item.id, 'm')
      registry.answer(item.id)
      await expect(pending).resolves.toEqual({ answered: true })
    })

    it('a second ask joins the pending one without notifying again', async () => {
      const publish = vi.fn()
      const registry = new BrowserRegistry(publish)
      const item = registry.create({})
      const first = registry.ask(item.id, 'm')
      const second = registry.ask(item.id, 'm')
      expect(publish.mock.calls.filter((c) => c[0] === 'ask')).toHaveLength(1)
      registry.answer(item.id, 'ok')
      await expect(first).resolves.toEqual({ answered: true, reply: 'ok' })
      await expect(second).resolves.toEqual({ answered: true, reply: 'ok' })
    })

    it('a second ask with a new message replaces it and republishes', () => {
      const publish = vi.fn()
      const registry = new BrowserRegistry(publish)
      const item = registry.create({})
      void registry.ask(item.id, 'one')
      const askedAt = registry.get(item.id)?.ask?.askedAt
      void registry.ask(item.id, 'two')
      expect(publish.mock.calls.filter((c) => c[0] === 'ask').map((c) => c[2])).toEqual([{ message: 'one' }, { message: 'two' }])
      expect(registry.get(item.id)?.ask).toEqual({ message: 'two', askedAt })
    })

    it('answer is false when nothing is pending or the id is unknown', () => {
      const registry = new BrowserRegistry(vi.fn())
      const item = registry.create({})
      expect(registry.answer(item.id)).toBe(false)
      expect(registry.answer('nope')).toBe(false)
    })

    it('removing the browser resolves pending asks as closed', async () => {
      const registry = new BrowserRegistry(vi.fn())
      const item = registry.create({})
      const pending = registry.ask(item.id, 'm')
      registry.remove(item.id)
      await expect(pending).resolves.toEqual({ answered: false, reason: 'closed' })
    })

    it('asking an unknown browser resolves as closed', async () => {
      const registry = new BrowserRegistry(vi.fn())
      await expect(registry.ask('nope', 'm')).resolves.toEqual({ answered: false, reason: 'closed' })
    })

    it('an aborted waiter leaves the ask pending for others', async () => {
      const registry = new BrowserRegistry(vi.fn())
      const item = registry.create({})
      const ctrl = new AbortController()
      const first = registry.ask(item.id, 'm', ctrl.signal)
      ctrl.abort()
      await expect(first).resolves.toEqual({ answered: false, reason: 'timeout' })
      expect(registry.get(item.id)?.ask?.message).toBe('m')
    })

    it('keeps an answer nobody was waiting for and hands it to the next ask once', async () => {
      const publish = vi.fn()
      const registry = new BrowserRegistry(publish)
      const item = registry.create({})
      const ctrl = new AbortController()
      const first = registry.ask(item.id, 'm', ctrl.signal)
      ctrl.abort()
      await first
      expect(registry.answer(item.id, '4242')).toBe(true)
      expect(publish).toHaveBeenLastCalledWith('answered', expect.objectContaining({ id: item.id }))
      await expect(registry.ask(item.id, 'm')).resolves.toEqual({ answered: true, reply: '4242' })
      expect(publish.mock.calls.filter((c) => c[0] === 'ask')).toHaveLength(1)
      // Claimed once: the next ask is a new one.
      void registry.ask(item.id, 'again')
      expect(registry.get(item.id)?.ask?.message).toBe('again')
    })

    it('never hands a kept answer to an ask with a different message', async () => {
      const registry = new BrowserRegistry(vi.fn())
      const item = registry.create({})
      const ctrl = new AbortController()
      const first = registry.ask(item.id, 'mfa code', ctrl.signal)
      ctrl.abort()
      await first
      registry.answer(item.id, '4242')
      const other = registry.ask(item.id, 'solve the captcha')
      expect(registry.get(item.id)?.ask?.message).toBe('solve the captcha')
      // Discarded, not kept for later: the old message no longer gets it either.
      registry.answer(item.id)
      await expect(other).resolves.toEqual({ answered: true })
      void registry.ask(item.id, 'mfa code')
      expect(registry.get(item.id)?.ask?.message).toBe('mfa code')
    })

    it('drops a kept answer after half an hour', async () => {
      vi.useFakeTimers()
      try {
        const registry = new BrowserRegistry(vi.fn())
        const item = registry.create({})
        const ctrl = new AbortController()
        const first = registry.ask(item.id, 'm', ctrl.signal)
        ctrl.abort()
        await first
        registry.answer(item.id, 'old')
        vi.advanceTimersByTime(30 * 60_000 + 1)
        void registry.ask(item.id, 'm')
        expect(registry.get(item.id)?.ask?.message).toBe('m')
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
