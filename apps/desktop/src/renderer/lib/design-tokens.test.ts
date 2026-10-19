import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from './themes.js'

// Vitest runs with apps/desktop as the root (see vitest.config.ts).
const RENDERER = join(process.cwd(), 'src/renderer')
const CSS = readFileSync(join(RENDERER, 'index.css'), 'utf8')

/**
 * The grey ladder every theme must define. Components read a rung instead of
 * computing one with color-mix; a theme that skips a rung silently falls back
 * to whatever the previous block set, which is exactly the drift these tests
 * exist to stop. See docs/superpowers/specs/2026-09-22-design-token-ladder-design.md.
 */
const LADDER = [
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--border',
  '--border-subtle',
  '--border-strong',
  '--muted-foreground',
  '--tertiary-foreground',
  '--disabled-foreground',
]

/** The token block a theme's selector opens, as raw CSS text. */
function themeBlock(id: string): string {
  // light and dark keep their historical `:root` / `.dark` selectors.
  const selector = id === 'light' ? ':root {' : id === 'dark' ? '.dark {' : `[data-theme='${id}'] {`
  const start = CSS.indexOf(selector)
  expect(start, `no token block for theme "${id}"`).toBeGreaterThan(-1)
  const end = CSS.indexOf('\n}', start)
  return CSS.slice(start, end)
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return tsxFiles(full)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : []
  })
}

describe('the grey ladder', () => {
  it.each(THEMES.map((t) => t.id))('theme "%s" defines every rung', (id) => {
    const block = themeBlock(id)
    for (const token of LADDER) {
      expect(block, `theme "${id}" is missing ${token}`).toContain(`${token}:`)
    }
  })

  it('gives the workbench theme the design system\'s literal values', () => {
    const block = themeBlock('workbench')
    expect(block).toContain('--surface-1: #101010')
    expect(block).toContain('--surface-2: #151515')
    expect(block).toContain('--surface-3: #1a1a1a')
    expect(block).toContain('--border-subtle: #1b1b1b')
    expect(block).toContain('--border-strong: #303030')
    expect(block).toContain('--tertiary-foreground: #686868')
    expect(block).toContain('--disabled-foreground: #404040')
  })

  it('points the workbench theme at its own self-hosted faces', () => {
    const block = themeBlock('workbench')
    expect(block).toContain("--font-sans: 'Inter Variable'")
    expect(block).toContain("--font-mono: 'JetBrains Mono Variable'")
    expect(CSS).toContain("@import '@fontsource-variable/inter'")
    expect(CSS).toContain("@import '@fontsource-variable/jetbrains-mono'")
  })
})

describe('no component derives its own greys', () => {
  // Surface and hairline greys — anything at or below 30% of the foreground —
  // belong to the ladder. Above that the foreground is being used as a legible
  // ink or indicator (a meter fill, an active-tab bar), which is not a rung.
  const AD_HOC_MIX = /color-mix\([^)]*var\(--foreground\)[_ ](?:[0-9]|[12][0-9]|30)%/

  // `text-muted-foreground/70` and friends: 21 distinct levels once lived here.
  const AD_HOC_OPACITY = /\b(?:text|bg|border|ring|outline|divide|fill|stroke)-(?:(?:muted|sidebar|card|popover)-)?foreground\/\d+/

  const files = tsxFiles(RENDERER)

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each([
    ['color-mix off --foreground', AD_HOC_MIX],
    ['an opacity-suffixed foreground token', AD_HOC_OPACITY],
  ])('never reaches for %s', (_what, pattern) => {
    const offenders = files
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RENDERER, f))
    expect(offenders).toEqual([])
  })

  it('leaves index.css with color-mix only where the ladder is defined', () => {
    // Everything below the theme blocks is component CSS, and must read rungs.
    const tail = CSS.slice(CSS.indexOf('@layer base {'))
    expect(tail).not.toMatch(AD_HOC_MIX)
  })
})
