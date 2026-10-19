import { describe, expect, it } from 'vitest'
import { loadManifestFromToml } from './toml.js'

const TOML = `
id = "subfinder"
name = "Subfinder"
description = "Passive subdomain enumeration"
category = "recon"
accepts = ["domain"]

[command]
program = "subfinder"
args = ["-silent", "-d", "{{ target.value }}"]

[emit]
parser = "json"

[[emit.targets]]
kind = "subdomain"
value = "{{ record.host }}"
parent = "input"
`

describe('loadManifestFromToml', () => {
  it('parses and validates a manifest from TOML text', () => {
    const m = loadManifestFromToml(TOML)
    expect(m.id).toBe('subfinder')
    expect(m.command.args).toEqual(['-silent', '-d', '{{ target.value }}'])
    expect(m.emit.targets[0]?.kind).toBe('subdomain')
  })

  it('throws on TOML that fails manifest validation', () => {
    expect(() => loadManifestFromToml('id = "Bad Id"')).toThrow()
  })
})
