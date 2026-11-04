import { describe, expect, it } from 'vitest'
import { formatLine, levelEnabled, parseLine, Redactor, SECRET_MASK, type LogLine } from './log.js'

const line = (over: Partial<LogLine> = {}): LogLine => ({
  t: '2026-11-03T10:00:00.000Z',
  lvl: 'info',
  src: 'main',
  msg: 'hello',
  ...over,
})

describe('levelEnabled', () => {
  it('gates lines below the minimum level', () => {
    expect(levelEnabled('info', 'debug')).toBe(false)
    expect(levelEnabled('info', 'info')).toBe(true)
    expect(levelEnabled('info', 'warn')).toBe(true)
    expect(levelEnabled('debug', 'debug')).toBe(true)
    expect(levelEnabled('error', 'warn')).toBe(false)
  })
})

describe('formatLine / parseLine', () => {
  it('round-trips a line without a trailing newline', () => {
    const x = line({ data: { a: 1, b: ['c'] } })
    const text = formatLine(x)
    expect(text.endsWith('\n')).toBe(false)
    expect(parseLine(text)).toEqual(x)
  })

  it('returns null for non-JSON or wrong shape', () => {
    expect(parseLine('not json')).toBeNull()
    expect(parseLine('{"msg":1}')).toBeNull()
    expect(parseLine('[]')).toBeNull()
    expect(parseLine('null')).toBeNull()
    expect(parseLine(JSON.stringify({ ...line(), lvl: 'loud' }))).toBeNull()
  })
})

describe('Redactor', () => {
  it('masks known values anywhere', () => {
    const r = new Redactor(['censys_abc123'])
    expect(r.redact(line({ msg: 'token censys_abc123 used' })).msg).toBe(`token ${SECRET_MASK} used`)
  })

  it('redacts known values inside nested data strings', () => {
    const r = new Redactor(['censys_abc123'])
    const out = r.redact(
      line({ data: { url: 'https://x/?q=censys_abc123', nested: { s: 'a censys_abc123' }, list: ['censys_abc123'] } }),
    )
    expect(out.data).toEqual({
      url: `https://x/?q=${SECRET_MASK}`,
      nested: { s: `a ${SECRET_MASK}` },
      list: [SECRET_MASK],
    })
  })

  it('replaces longer known values first', () => {
    const r = new Redactor(['abcd', 'abcdefgh'])
    expect(r.redact(line({ msg: 'abcdefgh' })).msg).toBe(SECRET_MASK)
  })

  it('masks by pattern', () => {
    const r = new Redactor()
    const m = (msg: string) => r.redact(line({ msg })).msg
    expect(m('Authorization: Bearer xyz')).toBe(`Authorization: ${SECRET_MASK}`)
    expect(m('got Bearer xyz ok')).toBe(`got Bearer ${SECRET_MASK} ok`)
    expect(m('GET /a?key=abc&x=1')).toBe(`GET /a?key=${SECRET_MASK}&x=1`)
    expect(m('a?token=abc&x=1')).toBe(`a?token=${SECRET_MASK}&x=1`)
    expect(m('a?api_key=abc&x=1')).toBe(`a?api_key=${SECRET_MASK}&x=1`)
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----'
    expect(m(`k ${pem} done`)).toBe(`k ${SECRET_MASK} done`)
    for (const tok of ['censys_abcdef123', 'sk-abcdef123', 'ghp_abcdef123', 'xoxb-abcdef123']) {
      expect(m(`x ${tok} y`)).toBe(`x ${SECRET_MASK} y`)
    }
  })

  it('masks by field name', () => {
    const r = new Redactor()
    const out = r.redact(
      line({ data: { password: 'p', apiKey: 'k', Authorization: 'a', secretToken: 's', other: 'ok', n: { passwd: 'z' } } }),
    )
    expect(out.data).toEqual({
      password: SECRET_MASK,
      apiKey: SECRET_MASK,
      Authorization: SECRET_MASK,
      secretToken: SECRET_MASK,
      other: 'ok',
      n: { passwd: SECRET_MASK },
    })
  })

  it('ignores known values shorter than 4 characters', () => {
    const r = new Redactor(['a', 'abc'])
    expect(r.redact(line({ msg: 'a banana abc' })).msg).toBe('a banana abc')
    r.setValues(['a', 'wxyz'])
    expect(r.redact(line({ msg: 'a wxyz' })).msg).toBe(`a ${SECRET_MASK}`)
  })

  it('does not mutate its input', () => {
    const r = new Redactor(['censys_abc123'])
    const x = line({ msg: 'censys_abc123', data: { password: 'p', s: ['censys_abc123'] } })
    const copy = structuredClone(x)
    r.redact(x)
    expect(x).toEqual(copy)
  })
})
describe('Redactor gaps', () => {
  const m = (s: string) => new Redactor().redact(line({ msg: s })).msg
  it('masks prefixed and underscore assignment names', () => {
    expect(m('GET /cb?access_token=abc123xyz&x=1')).toBe(`GET /cb?access_token=${SECRET_MASK}&x=1`)
    expect(m('client_secret=s3cr3tvalue')).toBe(`client_secret=${SECRET_MASK}`)
    expect(m('x_api_key=k9999 db_password=pw1 refresh_token=r1 passwd=p2')).toBe(
      `x_api_key=${SECRET_MASK} db_password=${SECRET_MASK} refresh_token=${SECRET_MASK} passwd=${SECRET_MASK}`,
    )
  })
  it('masks slack token prefixes', () => {
    for (const p of ['xoxb', 'xoxp', 'xoxa', 'xoxs']) expect(m(`t ${p}-1234567890-abcdef`)).toBe(`t ${SECRET_MASK}`)
  })
  it('masks the password in URL credentials', () => {
    expect(m('fetch https://admin:hunter2@x.com/path')).toBe(`fetch https://admin:${SECRET_MASK}@x.com/path`)
  })
  it('turns a cyclic data object into [circular] instead of throwing', () => {
    const data: Record<string, unknown> = { a: 1 }
    data.self = data
    const out = new Redactor().redact(line({ data }))
    expect((out.data as { self: unknown }).self).toBe('[circular]')
  })
})

