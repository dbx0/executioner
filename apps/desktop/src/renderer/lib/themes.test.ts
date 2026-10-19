import { afterEach, describe, expect, it } from 'vitest'
import {
  THEMES,
  DEFAULT_THEME,
  isKnownTheme,
  resolveTheme,
  themeBase,
  applyTheme,
  monacoTheme,
} from './themes.js'

afterEach(() => {
  const root = document.documentElement
  root.removeAttribute('data-theme')
  root.classList.remove('dark', 'theme-transition-disabled')
})

describe('theme registry', () => {
  it('keeps the legacy light and dark ids', () => {
    expect(isKnownTheme('light')).toBe(true)
    expect(isKnownTheme('dark')).toBe(true)
  })

  it('ships more than the two legacy themes', () => {
    expect(THEMES.length).toBeGreaterThan(2)
  })

  it('every theme has a unique id and a valid base', () => {
    const ids = new Set(THEMES.map((t) => t.id))
    expect(ids.size).toBe(THEMES.length)
    for (const t of THEMES) expect(t.base === 'light' || t.base === 'dark').toBe(true)
  })

  it('treats an unknown id as unknown and resolves it to the default', () => {
    expect(isKnownTheme('nope')).toBe(false)
    expect(resolveTheme('nope').id).toBe(DEFAULT_THEME)
  })

  it('reports the base for a theme', () => {
    expect(themeBase('light')).toBe('light')
    expect(themeBase('midnight')).toBe('dark')
  })

  it('ships the workbench theme on a dark base', () => {
    expect(isKnownTheme('workbench')).toBe(true)
    expect(resolveTheme('workbench').base).toBe('dark')
  })
})

describe('monacoTheme', () => {
  it('uses the light editor theme only for light-base themes', () => {
    expect(monacoTheme('light')).toBe('vs')
    expect(monacoTheme('paper')).toBe('vs')
  })

  it('uses the dark editor theme for every dark-base theme, not just `dark`', () => {
    for (const id of ['dark', 'midnight', 'high-contrast', 'workbench']) {
      expect(monacoTheme(id)).toBe('vs-dark')
    }
  })

  it('falls back with the default theme for an unknown id', () => {
    expect(monacoTheme('bogus')).toBe('vs-dark')
  })
})

describe('applyTheme', () => {
  it('sets data-theme and toggles .dark for a dark-base theme', () => {
    applyTheme('midnight')
    expect(document.documentElement.dataset.theme).toBe('midnight')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('clears .dark for a light-base theme', () => {
    applyTheme('paper')
    expect(document.documentElement.dataset.theme).toBe('paper')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('falls back to the default theme for an unknown id', () => {
    applyTheme('bogus')
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME)
  })

  it('sets data-theme and .dark for the workbench theme', () => {
    applyTheme('workbench')
    expect(document.documentElement.dataset.theme).toBe('workbench')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
