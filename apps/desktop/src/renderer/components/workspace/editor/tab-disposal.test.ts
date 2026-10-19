import { beforeEach, describe, expect, it, vi } from 'vitest'
import { disposeClosedEditorTabs, type MonacoModelRegistry } from './tab-disposal.js'
import { editorSelectionCache, scrollTopCache } from './view-state-cache.js'

function makeRegistry(): { registry: MonacoModelRegistry; disposed: string[] } {
  const disposed: string[] = []
  const registry: MonacoModelRegistry = {
    editor: {
      getModel: (uri) => ({
        dispose: () => {
          disposed.push(String(uri))
        },
      }),
    },
    Uri: { parse: (value: string) => value },
  }
  return { registry, disposed }
}

describe('disposeClosedEditorTabs', () => {
  beforeEach(() => {
    scrollTopCache.clear()
    editorSelectionCache.clear()
  })

  it('disposes the model for each closed tab', () => {
    const { registry, disposed } = makeRegistry()
    disposeClosedEditorTabs(registry, [
      { id: 'f1', path: 'a.ts' },
      { id: 'f2', path: 'b.ts' },
    ])
    expect(disposed).toEqual(['a.ts', 'b.ts'])
  })

  it('sweeps the view-state caches for the closed tabs', () => {
    const { registry } = makeRegistry()
    scrollTopCache.set('f1', 100)
    editorSelectionCache.set('f1', [])
    disposeClosedEditorTabs(registry, [{ id: 'f1', path: 'a.ts' }])
    expect(scrollTopCache.has('f1')).toBe(false)
    expect(editorSelectionCache.has('f1')).toBe(false)
  })

  it('leaves a still-open tab’s view state alone', () => {
    const { registry } = makeRegistry()
    scrollTopCache.set('f1', 100)
    scrollTopCache.set('f2', 200)
    disposeClosedEditorTabs(registry, [{ id: 'f1', path: 'a.ts' }])
    expect(scrollTopCache.get('f2')).toBe(200)
  })

  it('is a no-op for an empty batch', () => {
    const { registry, disposed } = makeRegistry()
    const getModel = vi.spyOn(registry.editor, 'getModel')
    disposeClosedEditorTabs(registry, [])
    expect(disposed).toEqual([])
    expect(getModel).not.toHaveBeenCalled()
  })

  it('tolerates a path with no retained model', () => {
    const { registry } = makeRegistry()
    registry.editor.getModel = () => null
    expect(() => disposeClosedEditorTabs(registry, [{ id: 'f1', path: 'a.ts' }])).not.toThrow()
  })
})
