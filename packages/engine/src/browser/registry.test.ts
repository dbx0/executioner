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
})
