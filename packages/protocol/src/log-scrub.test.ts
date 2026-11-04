import { describe, expect, it } from 'vitest'
import type { LogLine } from './log.js'
import { SECRET_MASK } from './log.js'
import { ENGAGEMENT_FIELDS, PATH_FIELDS, SCRUB_ALLOWLIST, Scrubber, TEXT_FIELDS } from './log-scrub.js'

const line = (msg: string, data?: Record<string, unknown>): LogLine => ({
  t: '2026-11-03T10:00:00.123Z',
  lvl: 'info',
  src: 'engine:abc/net',
  msg,
  ...(data ? { data } : {}),
})

const mk = () => new Scrubber({ home: '/home/u' })

describe('Scrubber', () => {
  it('exports the documented constants', () => {
    expect(SCRUB_ALLOWLIST).toContain('api.shodan.io')
    expect(SCRUB_ALLOWLIST).toContain('::1')
    expect([...TEXT_FIELDS]).toEqual(['text', 'prompt', 'output', 'body', 'finding'])
    expect([...PATH_FIELDS]).toEqual(['path', 'dir', 'root'])
    expect([...ENGAGEMENT_FIELDS]).toEqual(['engagement'])
  })

  it('maps hosts, ips and emails to stable placeholders', () => {
    const s = mk()
    expect(s.line(line('a.client.com then a.client.com then b.other.org')).msg).toBe('host-1 then host-1 then host-2')
    expect(s.line(line('from 10.1.2.3 and 2001:db8::1 and 10.1.2.3')).msg).toBe('from ip-1 and ip-2 and ip-1')
    expect(s.line(line('mail bob@client.com now')).msg).toBe('mail email-1 now')
    expect(s.line(line('mail bob@client.com')).msg).toBe('mail email-1')
  })

  it('keeps scheme, path and query keys of urls but drops host and values', () => {
    const out = mk().line(line('GET https://client.example/api/login?user=bob&x=1 failed')).msg
    expect(out).toBe('GET https://host-1/api/login?user=&x= failed')
  })

  it('keeps allowlisted hosts and loopback but scrubs ips inside', () => {
    const s = mk()
    expect(s.line(line('https://api.shodan.io/shodan/host/1.2.3.4')).msg).toBe('https://api.shodan.io/shodan/host/ip-1')
    expect(s.line(line('http://127.0.0.1:61337/x and localhost and [::1]')).msg).toBe(
      'http://127.0.0.1:61337/x and localhost and [::1]',
    )
    expect(s.line(line('github.com')).msg).toBe('github.com')
  })

  it('removes free text fields at any depth', () => {
    const s = mk()
    for (const k of TEXT_FIELDS) {
      const out = s.line(line('m', { [k]: 'x'.repeat(42), nested: { deep: [{ [k]: 'y'.repeat(5) }] } }))
      expect(out.data?.[k]).toBe('[42 chars removed]')
      expect(JSON.stringify(out.data?.nested)).toContain('[5 chars removed]')
    }
  })

  it('replaces engagement and path fields with one shared engagement namespace', () => {
    const s = mk()
    const a = s.line(line('m', { engagement: 'Acme', path: '/home/u/acme/x' }))
    expect(a.data).toEqual({ engagement: 'engagement-1', path: 'engagement-2' })
    const b = s.line(line('m', { dir: '/home/u/acme/x', engagement: 'Acme', root: 'Acme' }))
    expect(b.data).toEqual({ dir: 'engagement-2', engagement: 'engagement-1', root: 'engagement-1' })
  })

  it('turns home paths into path placeholders and still scrubs hosts', () => {
    const s = mk()
    expect(s.line(line('opened /home/u/notes.txt')).msg).toBe('opened path-1')
    expect(s.line(line('m', { file: '/home/u/x to api.client.com' })).data).toEqual({ file: 'path-2 to host-1' })
  })

  it('replaces filesystem paths in free text with stable placeholders', () => {
    const s = mk()
    const a = s.line(line('x', { message: "ENOENT: open '/home/u/Engagements/acme/evidence/x.json'" }))
    expect(JSON.stringify(a)).not.toContain('acme')
    expect(a.data?.message).toBe("ENOENT: open 'path-1'")
    const b = s.line(line("again '/home/u/Engagements/acme/evidence/x.json' and /srv/data/acme/y.txt."))
    expect(b.msg).toBe("again 'path-1' and path-2.")
  })

  it('takes a quoted path whole, spaces included', () => {
    const s = mk()
    const msg = "ENOENT: no such file or directory, open '/home/u/Engagements/Acme Corp/x.json'"
    const a = s.line(line(msg)).msg
    expect(a).toBe("ENOENT: no such file or directory, open 'path-1'")
    expect(a).not.toMatch(/Acme|Corp/)
    expect(s.line(line(msg)).msg).toBe(a)
    const win = new Scrubber({ home: 'C:\\Users\\bob' }).line(line('open "C:\\Users\\bob\\Acme Corp\\x.txt" failed')).msg
    expect(win).toBe('open "path-1" failed')
    expect(win).not.toMatch(/bob|Acme|Corp/)
    expect(s.line(line("at '/home/u/app/node_modules/my pkg/y.js'")).msg).toBe("at '~/app/node_modules/my pkg/y.js'")
  })

  it('keeps code paths readable in stack traces', () => {
    const out = mk().line(line('x', { stack: 'Error\n    at run (/home/u/app/node_modules/x/y.js:1:2)\n    at /opt/Executioner/resources/app.asar/main.js' })).data
    expect(out?.stack).toContain('(~/app/node_modules/x/y.js:1:2)')
    expect(out?.stack).toContain('/opt/Executioner/resources/app.asar/main.js')
  })

  it('removes the dash-encoded home form agent CLIs use for project folders', () => {
    const out = mk().line(line('read /home/u/.claude/projects/-home-u-acme/memory failed')).msg
    expect(out).not.toContain('-home-u')
    expect(out).not.toContain('acme')
    expect(out).toBe('read path-1 failed')
  })

  it('replaces Windows drive paths', () => {
    const s = new Scrubber({ home: 'C:\\Users\\bob' })
    const out = s.line(line('open C:\\Users\\bob\\acme\\x.txt and D:/cases/acme/y.txt')).msg
    expect(out).toMatch(/^open path-1 and path-2$/)
    expect(out).not.toMatch(/bob|acme/i)
  })

  it('leaves urls, routes, versions and the secret mask alone', () => {
    const s = mk()
    expect(s.line(line('GET https://client.example/a/b')).msg).toBe('GET https://host-1/a/b')
    expect(s.line(line('m', { route: '/api/workflows/:id', endpoint: '/targets/t1' })).data).toEqual({
      route: '/api/workflows/:id',
      endpoint: '/targets/t1',
    })
    expect(s.line(line(`v1.2.3 N/A 2026/11/03 ${SECRET_MASK}`)).msg).toBe(`v1.2.3 N/A 2026/11/03 ${SECRET_MASK}`)
  })

  it('does not treat versions, timestamps or file names as hosts or ips', () => {
    const s = mk()
    const out = s.line(line('app 0.0.6 and v1.2.3 loaded index.js at 10:00:00.123'))
    expect(out.msg).toBe('app 0.0.6 and v1.2.3 loaded index.js at 10:00:00.123')
    expect(out.t).toBe('2026-11-03T10:00:00.123Z')
    expect(out.src).toBe('engine:abc/net')
  })

  it('passes the secret mask through and does not mutate the input', () => {
    const s = mk()
    const input = line(`token ${SECRET_MASK}`, { k: SECRET_MASK, n: 3, ok: true, nil: null })
    const out = s.line(input)
    expect(out).toEqual(input)
    const orig = line('x.client.com', { text: 'abc' })
    s.line(orig)
    expect(orig.msg).toBe('x.client.com')
    expect(orig.data).toEqual({ text: 'abc' })
  })

  it('exposes no mapping', () => {
    const s = mk()
    s.line(line('secret.client.com'))
    expect(JSON.stringify(s)).not.toContain('client.com')
    const publicKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(s)).filter((k) => !k.startsWith('#'))
    expect(publicKeys.sort()).toEqual(['constructor', 'line'])
    expect(Object.keys(s)).toEqual([])
  })

  it('stays linear on long alphanumeric runs', () => {
    const start = Date.now()
    mk().line(line('a'.repeat(200000)))
    expect(Date.now() - start).toBeLessThan(1000)
  })

  it('scrubs internal and underscore hostnames but not files, calls or versions', () => {
    const s = mk()
    expect(s.line(line('db.corp.local')).msg).toBe('host-1')
    expect(s.line(line('_dmarc.client.com my_host.client.com')).msg).toBe('host-2 host-3')
    expect(s.line(line('x.client.example up')).msg).toBe('host-4 up')
    expect(s.line(line('run.sh index.js 0.0.6')).msg).toBe('run.sh index.js 0.0.6')
    expect(s.line(line('at Object.run (file.js:1)')).msg).toBe('at Object.run (file.js:1)')
    expect(s.line(line('foo.bar(x)')).msg).toBe('foo.bar(x)')
    expect(s.line(line('visit client.com (note)')).msg).toBe('visit host-5 (note)')
    expect(s.line(line('format client.com')).msg).toBe('format host-5')
    expect(s.line(line('stat db.corp.local')).msg).toBe('stat host-1')
    expect(s.line(line('look at client.com')).msg).toBe('look at host-5')
    expect(s.line(line('chat client.com (x)')).msg).toBe('chat host-5 (x)')
    expect(s.line(line('    at Foo.bar (x)')).msg).toBe('    at Foo.bar (x)')
  })

  it('normalises home path variants', () => {
    const win = new Scrubber({ home: 'C:\\Users\\bob' })
    // Code paths keep the home form visible, so they show the normalisation.
    for (const m of ['C:\\Users\\bob\\node_modules', 'C:/Users/bob/node_modules', 'c:\\users\\bob\\node_modules', 'file:///C:/Users/bob/node_modules']) {
      expect(win.line(line(m)).msg.startsWith('~')).toBe(true)
      expect(win.line(line(m)).msg).not.toMatch(/bob/i)
    }
    expect(new Scrubber({ home: '/Users/bob' }).line(line('/users/bob/node_modules/x')).msg).toBe('~/node_modules/x')
    expect(new Scrubber({ home: '/home/u/' }).line(line('/home/u/node_modules/x')).msg).toBe('~/node_modules/x')
    expect(new Scrubber({ home: '' }).line(line('/home/u/x')).msg).toBe('path-1')
  })

  it('treats packaged engine paths as code', () => {
    const sc = new Scrubber({ home: '/home/bob' })
    expect(sc.line(line('at f (/opt/Executioner/resources/engine/dist/cli.js:10:5)')).msg).toBe('at f (/opt/Executioner/resources/engine/dist/cli.js:10:5)')
    expect(sc.line(line('at C:\\App\\Resources\\Engine\\dist\\cli.js:1:2')).msg).toContain('Resources\\Engine')
  })
})
