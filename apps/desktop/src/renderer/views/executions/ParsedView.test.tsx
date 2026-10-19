import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ParsedView, cellText, summarizeParsed } from './ParsedView.js'

describe('cellText', () => {
  it('flattens the nested arrays real nodes emit', () => {
    // whatweb rows look like { _key: 'Country', string: ['UNITED STATES'] }.
    expect(cellText(['UNITED STATES'])).toBe('UNITED STATES')
    expect(cellText(['a', 'b'])).toBe('a, b')
  })

  it('keeps primitives readable and drops the empties', () => {
    expect(cellText(true)).toBe('true')
    expect(cellText(80)).toBe('80')
    expect(cellText(null)).toBe('')
    expect(cellText(['x', '', 'y'])).toBe('x, y')
  })
})

describe('ParsedView', () => {
  it('renders many records as a table with a column per key', () => {
    render(
      <ParsedView
        value={[
          { port: '80', service: 'http' },
          { port: '443', service: 'ssl/http' },
        ]}
      />,
    )
    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['port', 'service'])
    expect(screen.getByText('ssl/http')).toBeTruthy()
  })

  it('unions keys across rows so a sparse record does not lose its column', () => {
    render(<ParsedView value={[{ a: '1' }, { b: '2' }]} />)
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['a', 'b'])
  })

  it('renders a single record as a key/value list, not a one-row table', () => {
    render(<ParsedView value={[{ url: 'https://x.test', path: '/ev/shot.png', full_page: true }]} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('path')).toBeTruthy()
    expect(screen.getByText('/ev/shot.png')).toBeTruthy()
    expect(screen.getByText('true')).toBeTruthy()
  })

  it('renders an array of plain values as a list', () => {
    render(<ParsedView value={['a.example.com', 'b.example.com']} />)
    expect(screen.getByText('a.example.com')).toBeTruthy()
    expect(screen.getByText('b.example.com')).toBeTruthy()
  })

  it('falls back to JSON for a shape it cannot tabulate', () => {
    render(<ParsedView value={{ nested: { deep: 1 } }} />)
    // A lone object is still a record, so it renders as key/value.
    expect(screen.getByText('nested')).toBeTruthy()
    expect(screen.getByText('{"deep":1}')).toBeTruthy()
  })
})

describe('summarizeParsed', () => {
  it('describes the first record as key=value pairs for the card', () => {
    expect(summarizeParsed([{ port: '80', service: 'http' }])).toBe('port=80  service=http')
  })

  it('skips empty fields so the preview is not full of blanks', () => {
    expect(summarizeParsed([{ registrar: '', expiry_date: '20270306' }])).toBe('expiry_date=20270306')
  })

  it('is empty when there is nothing parsed', () => {
    expect(summarizeParsed(null)).toBe('')
    expect(summarizeParsed([])).toBe('')
  })
})
