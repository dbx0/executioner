import { describe, expect, it } from 'vitest'
import { NodeRegistry, loadManifests, bundledManifestsDir } from './registry.js'

describe('loadManifests', () => {
  it('loads and validates every bundled manifest', () => {
    const map = loadManifests(bundledManifestsDir())
    expect(map.get('subfinder')?.name).toBe('Subfinder')
    expect(map.get('nmap')?.emit.parser).toBe('regex')
    expect(map.get('nuclei')?.emit.parser).toBe('json')
  })

  it('gives every typed-in param an example to show inside the empty field', () => {
    const missing: string[] = []
    for (const [id, manifest] of loadManifests(bundledManifestsDir())) {
      for (const [name, spec] of Object.entries(manifest.params)) {
        if ((spec.type === 'string' || spec.type === 'number') && spec.placeholder === undefined) {
          missing.push(`${id}.${name}`)
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('NodeRegistry', () => {
  it('lists and gets manifests', () => {
    const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
    expect(registry.get('subfinder')?.id).toBe('subfinder')
    expect(registry.get('nope')).toBeUndefined()
    expect(registry.list().map((m) => m.id).sort()).toEqual([
      'amass',
      'dalfox',
      'dig',
      'dnsx',
      'enum4linux',
      'feroxbuster',
      'ffuf',
      'gau',
      'gobuster',
      'gowitness',
      'httpx',
      'hydra',
      'katana',
      'masscan',
      'mtr',
      'naabu',
      'nbtscan',
      'netexec',
      'nikto',
      'nmap',
      'nuclei',
      'rustscan',
      'searchsploit',
      'sqlmap',
      'sslscan',
      'subfinder',
      'testssl',
      'theharvester',
      'traceroute',
      'wafw00f',
      'whatweb',
      'whois',
      'wpscan',
    ])
  })
})
