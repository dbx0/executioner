import { describe, expect, it } from 'vitest'
import { canonicaliseAsset, isCanonicalAsset, type CanonicalAsset } from './asset.js'

/** Unwraps a successful canonicalisation, failing loudly when it was rejected. */
const ok = (kind: string, value: string): CanonicalAsset => {
  const result = canonicaliseAsset({ kind, value })
  if (!isCanonicalAsset(result)) {
    throw new Error(`expected ${kind} "${value}" to canonicalise, got: ${result.error}`)
  }
  return result
}

const err = (kind: string, value: string): string => {
  const result = canonicaliseAsset({ kind, value })
  if (isCanonicalAsset(result)) {
    throw new Error(`expected ${kind} "${value}" to be rejected, got: ${result.value}`)
  }
  return result.error
}

describe('canonicaliseAsset — hostnames', () => {
  it('folds case and a trailing dot away', () => {
    expect(ok('domain', 'Example.COM.').value).toBe('example.com')
  })

  it('derives the apex through the public suffix list, not by counting labels', () => {
    // The bug this whole change exists for: smartfit.com.br is an apex, but
    // "last two labels" would call it a subdomain of the com.br suffix.
    const apex = ok('subdomain', 'smartfit.com.br')
    expect(apex.kind).toBe('domain')
    expect(apex.apex).toBe('smartfit.com.br')
  })

  it('files a host under a multi-part suffix as a subdomain of its apex', () => {
    const host = ok('domain', 'app.smartfit.com.br')
    expect(host.kind).toBe('subdomain')
    expect(host.apex).toBe('smartfit.com.br')
  })

  it('overrides the caller kind rather than trusting it', () => {
    // SMARTFIT has agenttech.smartfit.cloud as "subdomain" and smartfit.cloud as
    // "domain" — but also api-bf.bioritmo.com.br as both. The caller's guess is
    // a hint; the value decides.
    expect(ok('domain', 'agenttech.smartfit.cloud').kind).toBe('subdomain')
    expect(ok('subdomain', 'smartfit.cloud').kind).toBe('domain')
  })

  it('strips a scheme that was pasted into a hostname field', () => {
    expect(ok('domain', 'https://smartfit.com').value).toBe('smartfit.com')
  })

  it('strips a port, because a port is a fact about a host and not another host', () => {
    expect(ok('subdomain', 'auth.smartfit.cloud:8443').value).toBe('auth.smartfit.cloud')
  })

  it('punycodes an internationalised name so both spellings are one row', () => {
    expect(ok('domain', 'café.com').value).toBe(ok('domain', 'xn--caf-dma.com').value)
  })

  it('still groups a name outside the suffix list under a guessed apex', () => {
    // No public suffix matches ".internal", so the last two labels are taken as
    // the apex. Grouping internal hosts together beats making each one a root.
    const internal = ok('domain', 'jump.ha.internal')
    expect(internal.kind).toBe('subdomain')
    expect(internal.apex).toBe('ha.internal')
  })

  it('treats a single-label name as its own apex', () => {
    const single = ok('domain', 'localhost')
    expect(single.kind).toBe('domain')
    expect(single.apex).toBe('localhost')
  })

  it('reclassifies a bare IP handed in as a hostname', () => {
    const ip = ok('domain', '54.234.85.144')
    expect(ip.kind).toBe('ip')
    expect(ip.apex).toBeNull()
  })

  it('rejects a wildcard, which is a scope rule and never an asset', () => {
    expect(err('domain', '*.smartfit.com.br')).toMatch(/wildcard/i)
  })

  it('rejects a hostname with no dot-separated labels at all', () => {
    expect(err('domain', '   ')).toMatch(/empty/i)
  })

  it('rejects a hostname containing a path', () => {
    expect(err('subdomain', 'smartfit.com/totem')).toMatch(/hostname/i)
  })

  it('rejects shell syntax and quotes, which no DNS name carries', () => {
    for (const value of ['a"b.com', "a'b.com", 'x;id;.com', 'a$(id).com', 'a`id`.com', 'a|b.com']) {
      expect(err('domain', value)).toMatch(/not a valid hostname/i)
    }
  })

  it('rejects a label starting with "-", so a target can never pose as a tool flag', () => {
    expect(err('domain', '--script=http-shellshock')).toMatch(/not a valid hostname/i)
    expect(err('subdomain', '-oProxyCommand.example.com')).toMatch(/not a valid hostname/i)
  })

  it('still takes underscores and inner hyphens, which real hosts use', () => {
    expect(ok('subdomain', '_dmarc.example.com').value).toBe('_dmarc.example.com')
    expect(ok('subdomain', 'my-api.example.com').value).toBe('my-api.example.com')
  })
})

describe('canonicaliseAsset — ip and cidr', () => {
  it('trims an IPv4 address', () => {
    expect(ok('ip', ' 10.0.0.1 ').value).toBe('10.0.0.1')
  })

  it('compresses and lowercases IPv6 so one address is one row', () => {
    expect(ok('ip', ' 2001:0DB8:0000:0000:0000:0000:0000:0001 ').value).toBe('2001:db8::1')
  })

  it('rejects a malformed IPv4 address instead of storing it verbatim', () => {
    expect(err('ip', '999.1.1.1')).toMatch(/ip address/i)
  })

  it('rejects the trailing-dot IPv6 string the old normaliser let through', () => {
    expect(err('ip', '2001:DB8::1.')).toMatch(/ip address/i)
  })

  it('masks host bits off a CIDR so one network is one row', () => {
    expect(ok('cidr', '10.0.0.5/24').value).toBe('10.0.0.0/24')
  })

  it('rejects a CIDR with an out-of-range prefix length', () => {
    expect(err('cidr', '10.0.0.0/33')).toMatch(/prefix/i)
  })
})

describe('canonicaliseAsset — urls', () => {
  it('lowercases the scheme and host but leaves the path alone', () => {
    expect(ok('url', 'HTTPS://App.SmartFit.com.br/API/Locations').value).toBe(
      'https://app.smartfit.com.br/API/Locations',
    )
  })

  it('drops a default port', () => {
    expect(ok('url', 'https://smartfit.com:443/a').value).toBe('https://smartfit.com/a')
  })

  it('keeps a non-default port', () => {
    expect(ok('url', 'https://smartfit.com:8443/a').value).toBe('https://smartfit.com:8443/a')
  })

  it('drops the fragment, which never reaches the server', () => {
    expect(ok('url', 'https://smartfit.com/a#section').value).toBe('https://smartfit.com/a')
  })

  it('collapses an empty path to a single slash', () => {
    expect(ok('url', 'https://bapp-oicdb-cron.bioritmo.io').value).toBe(
      'https://bapp-oicdb-cron.bioritmo.io/',
    )
  })

  it('keeps a trailing slash on a non-empty path, which can be a different route', () => {
    // app.smartfit.com.br/api/zipcodes/ and /api/zipcodes are stored as written:
    // some routers treat them differently, so folding them would lose a target.
    expect(ok('url', 'https://app.smartfit.com.br/api/zipcodes/').value).toBe(
      'https://app.smartfit.com.br/api/zipcodes/',
    )
  })

  it('preserves query parameter order, which is semantic on some APIs', () => {
    expect(ok('url', 'https://smartfit.com/q?b=2&a=1').value).toBe('https://smartfit.com/q?b=2&a=1')
  })

  it('records the host and apex so a url can be attributed to its asset', () => {
    const url = ok('url', 'https://qrfo53hqq5frrfmgr2o35ewfli.appsync-api.us-east-1.amazonaws.com/graphql')
    expect(url.host).toBe('qrfo53hqq5frrfmgr2o35ewfli.appsync-api.us-east-1.amazonaws.com')
    expect(url.apex).toBe('amazonaws.com')
  })

  it('rejects a url with no scheme rather than guessing one', () => {
    expect(err('url', 'app.smartfit.com.br/api')).toMatch(/url/i)
  })

  it('rejects a non-http scheme', () => {
    expect(err('url', 'javascript:alert(1)')).toMatch(/http/i)
  })
})

describe('canonicaliseAsset — unknown kinds', () => {
  it('rejects a kind it does not model', () => {
    expect(err('planet', 'mars')).toMatch(/kind/i)
  })
})
