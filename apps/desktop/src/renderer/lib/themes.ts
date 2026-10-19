/**
 * The app's named-theme system. Each theme is a block of CSS-variable tokens in
 * index.css keyed by a `data-theme` attribute on the document root (light/dark
 * keep their historical `:root` / `.dark` blocks for backward compatibility).
 *
 * Adding a theme is two edits: one token block in index.css and one entry here.
 * A theme declares a `base` of 'light' or 'dark' so the Tailwind `dark:` variant
 * (darkMode: 'class') and any un-overridden token fall back sensibly.
 */
export interface ThemeDef {
  /** Stable id, stored in localStorage and written to `data-theme`. */
  id: string
  /** Human label for the picker. */
  label: string
  /** A one-line description shown under the label. */
  description: string
  /** Whether the theme reads as light or dark (drives the `.dark` class). */
  base: 'light' | 'dark'
  /** Two swatch colors (bg, accent) for the picker preview. */
  swatch: { bg: string; fg: string }
}

/** The built-in themes. The first light + first dark are the legacy defaults. */
export const THEMES: ThemeDef[] = [
  { id: 'light', label: 'Light', description: 'Clean near-white workspace.', base: 'light', swatch: { bg: '#ffffff', fg: '#171717' } },
  { id: 'dark', label: 'Dark', description: 'The default near-black surface.', base: 'dark', swatch: { bg: '#0a0a0a', fg: '#fafafa' } },
  { id: 'paper', label: 'Paper', description: 'Warm, low-glare off-white.', base: 'light', swatch: { bg: '#f6f2e9', fg: '#3a352c' } },
  { id: 'midnight', label: 'Midnight', description: 'Deep-blue low-light theme.', base: 'dark', swatch: { bg: '#0b1120', fg: '#e2e8f0' } },
  { id: 'high-contrast', label: 'High contrast', description: 'Maximum-contrast dark for legibility.', base: 'dark', swatch: { bg: '#000000', fg: '#ffffff' } },
  { id: 'workbench', label: 'Workbench', description: 'Dense near-black technical workbench.', base: 'dark', swatch: { bg: '#050505', fg: '#e7e7e7' } },
]

/** The theme used when nothing is stored and the OS gives no hint. */
export const DEFAULT_THEME = 'dark'

const THEME_BY_ID = new Map(THEMES.map((t) => [t.id, t]))

/** Whether an arbitrary string names a built-in theme. */
export function isKnownTheme(id: string): boolean {
  return THEME_BY_ID.has(id)
}

/** Resolve a theme (falling back to the default) — never returns undefined. */
export function resolveTheme(id: string): ThemeDef {
  return THEME_BY_ID.get(id) ?? THEME_BY_ID.get(DEFAULT_THEME) ?? THEMES[1]!
}

/** The light/dark base a theme reads as (drives the Tailwind `.dark` variant). */
export function themeBase(id: string): 'light' | 'dark' {
  return resolveTheme(id).base
}

/**
 * The Monaco built-in editor theme that goes with a named theme. Keyed off the
 * theme's base rather than the id, so every dark theme gets the dark editor —
 * not just the one literally called `dark`.
 */
export function monacoTheme(id: string): 'vs' | 'vs-dark' {
  return themeBase(id) === 'dark' ? 'vs-dark' : 'vs'
}

/**
 * Apply a theme to the document root: set `data-theme` (which selects the token
 * block) and toggle the `.dark` class so `dark:` Tailwind variants and dark
 * fallbacks track the theme's base. Transitions are suppressed for one frame so
 * the flip doesn't stagger.
 */
export function applyTheme(id: string): void {
  const theme = resolveTheme(id)
  const root = document.documentElement
  root.classList.add('theme-transition-disabled')
  root.dataset.theme = theme.id
  root.classList.toggle('dark', theme.base === 'dark')
  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.classList.remove('theme-transition-disabled')),
  )
  // Tell the main process to match the native window appearance so the macOS
  // traffic lights (and any native chrome) render for the right base — otherwise
  // a light in-app theme keeps dark traffic lights that look backgroundless.
  try {
    window.executioner?.setAppearance?.(theme.base)
  } catch {
    /* preload not present (e.g. tests) */
  }
}
