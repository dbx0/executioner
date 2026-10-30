import { describe, expect, it } from 'vitest'
import { editMenuTemplate, type EditMenuParams } from './edit-menu.js'

const flags = { canCut: false, canCopy: false, canPaste: false, canSelectAll: false }
const params = (over: Partial<EditMenuParams>): EditMenuParams => ({
  isEditable: false,
  selectionText: '',
  editFlags: flags,
  ...over,
})

describe('editMenuTemplate', () => {
  it('offers nothing where there is no text to act on', () => {
    expect(editMenuTemplate(params({}))).toBeNull()
  })

  it('offers copy for a selection outside a field', () => {
    const items = editMenuTemplate(params({ selectionText: 'hi', editFlags: { ...flags, canCopy: true } }))
    expect(items?.map((i) => i.role)).toEqual(['copy'])
  })

  // A right-click in the terminal lands on xterm's hidden textarea, which holds
  // the selected text, so Copy and Paste both come from the same field.
  it('offers the edit actions in a field, enabled by what the field allows', () => {
    const items = editMenuTemplate(
      params({ isEditable: true, selectionText: 'whoami', editFlags: { ...flags, canCopy: true, canPaste: true } }),
    )
    expect(items?.filter((i) => i.type !== 'separator').map((i) => [i.role, i.enabled])).toEqual([
      ['cut', false],
      ['copy', true],
      ['paste', true],
      ['selectAll', false],
    ])
  })
})
