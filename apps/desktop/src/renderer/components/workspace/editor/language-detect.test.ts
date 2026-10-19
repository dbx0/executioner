import { describe, expect, it } from 'vitest'
import { detectLanguage } from './language-detect.js'

describe('detectLanguage', () => {
  it('maps the tsx/jsx family onto their base language ids', () => {
    // Monaco has no 'typescriptreact' id — .tsx resolves to 'typescript'.
    expect(detectLanguage('a/b/App.tsx')).toBe('typescript')
    expect(detectLanguage('App.jsx')).toBe('javascript')
    expect(detectLanguage('script.mjs')).toBe('javascript')
    expect(detectLanguage('config.cts')).toBe('typescript')
  })

  it('maps common data and markup extensions', () => {
    expect(detectLanguage('pkg.json')).toBe('json')
    expect(detectLanguage('README.md')).toBe('markdown')
    expect(detectLanguage('index.html')).toBe('html')
    expect(detectLanguage('main.css')).toBe('css')
    expect(detectLanguage('run.py')).toBe('python')
    expect(detectLanguage('main.go')).toBe('go')
    expect(detectLanguage('lib.rs')).toBe('rust')
    expect(detectLanguage('deploy.yaml')).toBe('yaml')
    expect(detectLanguage('Cargo.toml')).toBe('toml')
    expect(detectLanguage('query.sql')).toBe('sql')
    expect(detectLanguage('run.sh')).toBe('shell')
  })

  it('matches known extensionless filenames by basename', () => {
    expect(detectLanguage('/repo/Dockerfile')).toBe('dockerfile')
    expect(detectLanguage('/repo/Makefile')).toBe('makefile')
  })

  it('is case-insensitive on the extension', () => {
    expect(detectLanguage('NOTES.MD')).toBe('markdown')
  })

  it('falls back to plaintext for an unknown or absent extension', () => {
    expect(detectLanguage('data.unknownext')).toBe('plaintext')
    expect(detectLanguage('LICENSE')).toBe('plaintext')
  })

  it('does not mistake a dot in a directory for an extension', () => {
    expect(detectLanguage('/a.b/c/notes')).toBe('plaintext')
  })
})
