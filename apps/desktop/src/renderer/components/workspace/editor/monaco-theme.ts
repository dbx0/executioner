import type { editor } from 'monaco-editor'
import { monaco } from '../../../lib/monaco-setup.js'
import { monacoTheme } from '../../../lib/themes.js'
import { tokenColors } from '../../terminal/theme-colors.js'

/** Monaco color ids mapped to the theme token each one takes. */
const EDITOR_TOKENS = {
  'editor.background': '--background',
  'editor.foreground': '--foreground',
  'editorCursor.foreground': '--foreground',
  'editorLineNumber.foreground': '--tertiary-foreground',
  'editorLineNumber.activeForeground': '--foreground',
  'editor.lineHighlightBackground': '--glass',
  'editor.lineHighlightBorder': '--background',
  'editor.selectionBackground': '--glass-active',
  'editor.inactiveSelectionBackground': '--glass-strong',
  'editorIndentGuide.background1': '--glass-border',
  'editorGutter.background': '--background',
  'editorWidget.background': '--popover',
  'editorWidget.border': '--border-subtle',
  'scrollbarSlider.background': '--glass-strong',
  'scrollbarSlider.hoverBackground': '--glass-active',
  'scrollbarSlider.activeBackground': '--glass-active',
  'editorOverviewRuler.border': '--background',
} as const

/**
 * Define (or refresh) the Monaco theme for an app theme and return its name.
 *
 * The built-in `vs-dark` paints a grey ground that does not match the ink card
 * the editor sits in, so each app theme gets its own Monaco theme: the built-in
 * one for its base supplies the syntax colors, and the surfaces come from the
 * tokens. Redefining under the same name repaints an editor already using it,
 * which is what a theme switch needs. Where Monaco is not really there (tests),
 * this falls back to the built-in theme name.
 */
export function editorTheme(themeId: string): string {
  const base = monacoTheme(themeId)
  const api = (monaco as { editor?: Partial<typeof editor> }).editor
  if (api?.defineTheme === undefined) return base
  const name = `executioner-${themeId.replace(/[^a-z0-9-]/gi, '-')}`
  // Monaco only takes hex here and paints an unparseable value red, so a token
  // that does not resolve to a color is left to the base theme.
  api.defineTheme(name, { base, inherit: true, rules: [], colors: tokenColors(EDITOR_TOKENS) as Record<string, string> })
  return name
}
