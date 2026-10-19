import { describe, expect, it } from 'vitest'
import { extractRecords } from './parsers.js'

describe('extractRecords json', () => {
  it('reads JSON lines', () => {
    const input = '{"host":"a.example.com"}\n{"host":"b.example.com"}\n'
    const records = extractRecords({ parser: 'json', records: '$' }, input)
    expect(records).toEqual([{ host: 'a.example.com' }, { host: 'b.example.com' }])
  })

  it('reads a JSON array selected by a dotted records path', () => {
    const input = '{"hosts":[{"host":"a.example.com"}]}'
    const records = extractRecords({ parser: 'json', records: '$.hosts' }, input)
    expect(records).toEqual([{ host: 'a.example.com' }])
  })
})

describe('extractRecords regex', () => {
  it('turns named capture groups into records', () => {
    const input = '80/tcp open http\n443/tcp open https\n'
    const records = extractRecords(
      { parser: 'regex', pattern: '(?<port>\\d+)/tcp\\s+open\\s+(?<service>\\S+)' },
      input,
    )
    expect(records).toEqual([
      { port: '80', service: 'http' },
      { port: '443', service: 'https' },
    ])
  })
})

describe('extractRecords file', () => {
  it('decodes jsonl file content', () => {
    const input = '{"id":"CVE-1"}\n{"id":"CVE-2"}\n'
    const records = extractRecords({ parser: 'file', format: 'jsonl' }, input)
    expect(records).toEqual([{ id: 'CVE-1' }, { id: 'CVE-2' }])
  })

  it('decodes a json array file', () => {
    const input = '[{"id":"CVE-1"}]'
    const records = extractRecords({ parser: 'file', format: 'json' }, input)
    expect(records).toEqual([{ id: 'CVE-1' }])
  })
})

describe('extractRecords wildcard selector', () => {
  const doc = JSON.stringify([
    { target: 'a', plugins: { nginx: { version: ['1.18'] }, HTML5: {} } },
    { target: 'b', plugins: { WordPress: { version: ['6.4'] } } },
  ])

  it('expands an object map, carrying the key as _key', () => {
    const records = extractRecords({ parser: 'json', records: '$[*].plugins.*' }, doc)
    expect(records).toEqual([
      { _key: 'nginx', version: ['1.18'] },
      { _key: 'HTML5' },
      { _key: 'WordPress', version: ['6.4'] },
    ])
  })

  it('still handles a plain array root and a dotted path (backward compatible)', () => {
    expect(extractRecords({ parser: 'json', records: '$' }, '[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }])
    expect(extractRecords({ parser: 'json', records: '$.results' }, '{"results":[{"u":"x"}]}')).toEqual([{ u: 'x' }])
  })
})

describe('extractRecords errors', () => {
  it('throws on malformed json', () => {
    expect(() => extractRecords({ parser: 'json', records: '$' }, 'not json')).toThrow()
  })
})
