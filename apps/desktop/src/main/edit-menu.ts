import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

/** The parts of Electron's context-menu params the edit menu reads. */
export type EditMenuParams = Pick<ContextMenuParams, 'isEditable' | 'selectionText'> & {
  editFlags: Pick<ContextMenuParams['editFlags'], 'canCut' | 'canCopy' | 'canPaste' | 'canSelectAll'>
}

/**
 * The right-click menu for text: Cut, Copy, Paste and Select all inside a field,
 * Copy alone over a plain selection, nothing anywhere else. Electron draws no
 * context menu by itself, so without this a right-click did nothing, not even
 * in the terminal, whose right-click puts the selection into xterm's textarea
 * exactly so a native Copy can take it.
 */
export function editMenuTemplate(params: EditMenuParams): MenuItemConstructorOptions[] | null {
  const { isEditable, selectionText, editFlags } = params
  if (isEditable) {
    return [
      { role: 'cut', label: 'Cut', enabled: editFlags.canCut },
      { role: 'copy', label: 'Copy', enabled: editFlags.canCopy },
      { role: 'paste', label: 'Paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'Select all', enabled: editFlags.canSelectAll },
    ]
  }
  if (selectionText.trim() !== '') return [{ role: 'copy', label: 'Copy', enabled: editFlags.canCopy }]
  return null
}
