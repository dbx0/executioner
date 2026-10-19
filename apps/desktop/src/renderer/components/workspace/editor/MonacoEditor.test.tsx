import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }))

// Mock the widget so these tests assert our wiring, not Monaco's internals.
vi.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    captured.props.push(props)
    return <div data-testid="monaco" />
  },
  loader: { config: vi.fn() },
}))
vi.mock('../../../lib/monaco-setup.js', () => ({
  monaco: { KeyMod: { CtrlCmd: 2048 }, KeyCode: { KeyS: 49 } },
}))

import { MonacoEditor } from './MonacoEditor.js'

function lastProps(): Record<string, unknown> {
  const props = captured.props.at(-1)
  if (props === undefined) throw new Error('editor was not rendered')
  return props
}

describe('MonacoEditor', () => {
  beforeEach(() => {
    captured.props.length = 0
  })

  it('retains its model and owns view-state restoration', () => {
    render(
      <MonacoEditor
        fileId="f1"
        filePath="a.ts"
        content="const a = 1"
        language="typescript"
        onContentChange={() => {}}
        onSave={() => {}}
      />,
    )
    const props = lastProps()
    // keepCurrentModel is what makes undo history survive a tab switch, and
    // saveViewState={false} stops Monaco's own view-state map fighting ours.
    expect(props.keepCurrentModel).toBe(true)
    expect(props.saveViewState).toBe(false)
    // defaultValue, not value: content sync is ours, and a controlled prop
    // would double-setValue on every external update.
    expect(props.defaultValue).toBe('const a = 1')
    expect(props.value).toBeUndefined()
    // path gives the file its own model URI, which tab disposal looks up.
    expect(props.path).toBe('a.ts')
    expect(props.language).toBe('typescript')
  })

  it('passes readOnly through to the editor options', () => {
    render(
      <MonacoEditor
        fileId="f1"
        filePath="a.ts"
        content="x"
        language="typescript"
        readOnly
        onContentChange={() => {}}
        onSave={() => {}}
      />,
    )
    expect((lastProps().options as { readOnly?: boolean }).readOnly).toBe(true)
  })

  it('reports edits through onContentChange', () => {
    const onContentChange = vi.fn()
    render(
      <MonacoEditor
        fileId="f1"
        filePath="a.ts"
        content="x"
        language="typescript"
        onContentChange={onContentChange}
        onSave={() => {}}
      />,
    )
    const onChange = lastProps().onChange as (value: string | undefined) => void
    onChange('edited')
    expect(onContentChange).toHaveBeenCalledWith('edited')
  })

  it('ignores an undefined change payload rather than wiping the buffer', () => {
    const onContentChange = vi.fn()
    render(
      <MonacoEditor
        fileId="f1"
        filePath="a.ts"
        content="x"
        language="typescript"
        onContentChange={onContentChange}
        onSave={() => {}}
      />,
    )
    const onChange = lastProps().onChange as (value: string | undefined) => void
    onChange(undefined)
    expect(onContentChange).not.toHaveBeenCalled()
  })
})
