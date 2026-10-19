import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildArgv } from './command.js'
import { resolveParams } from './params.js'
import { bundledManifestsDir } from './registry.js'
import { loadManifestFromToml } from './toml.js'

const manifestsDir = bundledManifestsDir()

function argvFor(id: string, params: Record<string, unknown>): string[] {
  const manifest = loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8'))
  const resolved = resolveParams(manifest, params)
  return buildArgv(manifest, { target: { value: 'target.tld' }, params: resolved }).args
}

function paramsOf(id: string) {
  return loadManifestFromToml(readFileSync(join(manifestsDir, `${id}.toml`), 'utf8')).params
}

/**
 * Each row restores options dropped from an existing manifest. We assert both that
 * the param is declared (with the original enum values / defaults) and that a
 * sample invocation wires it into argv exactly as the original built its command.
 */
describe('restored options wire into argv', () => {
  it('nmap: scan_type and timing enums drive the leading flags', () => {
    const p = paramsOf('nmap')
    expect(p.scan_type).toMatchObject({ type: 'enum', default: '-sV' })
    expect((p.scan_type as { values: string[] }).values).toEqual(['-sS', '-sV', '-sC', '-A', '-sT', '-sU'])
    expect((p.timing as { values: string[] }).values).toEqual(['-T0', '-T1', '-T2', '-T3', '-T4', '-T5'])
    expect(argvFor('nmap', {})).toEqual(['-sV', '-T3', '-p', '1-1000', 'target.tld'])
    expect(argvFor('nmap', { scan_type: '-sS', timing: '-T4' })).toEqual([
      '-sS', '-T4', '-p', '1-1000', 'target.tld',
    ])
  })

  it('rustscan: nmap_flags appended, dropped when blank', () => {
    expect(paramsOf('rustscan').nmap_flags).toMatchObject({ type: 'string', ui: 'textarea' })
    expect(argvFor('rustscan', { nmap_flags: '-sV -sC' })).toEqual([
      '-a', 'target.tld', '-r', '1-65535', '-sV -sC',
    ])
    expect(argvFor('rustscan', {})).toEqual(['-a', 'target.tld', '-r', '1-65535'])
  })

  it('wpscan: enumerate becomes --enumerate <opts>', () => {
    expect(argvFor('wpscan', { enumerate: 'u,p,t' })).toEqual([
      '--url', 'target.tld', '--format', 'json', '--enumerate', 'u,p,t',
    ])
    expect(argvFor('wpscan', {})).toEqual(['--url', 'target.tld', '--format', 'json'])
  })

  it('nuclei: tags/severity/templates wire into flags', () => {
    expect(argvFor('nuclei', { tags: 'cve,xss', severity: 'high,critical' })).toEqual([
      '-u', 'target.tld', '-jsonl',
      '-tags', 'cve,xss', '-severity', 'high,critical',
    ])
    // No templates path: nuclei falls back to the templates it installed, which
    // works for any user on any host (a fixed /root path does not).
    expect(argvFor('nuclei', {})).toEqual(['-u', 'target.tld', '-jsonl'])
    expect(argvFor('nuclei', { templates: '/opt/t' })).toEqual(['-u', 'target.tld', '-jsonl', '-t', '/opt/t'])
  })

  it('sqlmap: dbms/output_dir/additional_flags with a destructive warning', () => {
    expect(paramsOf('sqlmap').additional_flags).toMatchObject({
      warning: 'sqlmap may be destructive — ensure you have authorization',
    })
    expect(argvFor('sqlmap', { dbms: 'mysql', additional_flags: '--tamper=space2comment' })).toEqual([
      '-u', 'target.tld', '--batch', '--output-dir', '/tmp/sqlmap_output',
      '--level', '1', '--risk', '1', '--dbms', 'mysql', '--tamper=space2comment',
    ])
    expect(argvFor('sqlmap', { output_dir: '/data/out' })).toContain('/data/out')
  })

  it('gau: include_subdomains toggle and providers', () => {
    expect(argvFor('gau', { include_subdomains: true, providers: 'wayback,otx' })).toEqual([
      '--json', '--threads', '5', '--subs', '--providers', 'wayback,otx', 'target.tld',
    ])
    expect(argvFor('gau', {})).toEqual(['--json', '--threads', '5', 'target.tld'])
  })

  it('searchsploit: exact_title toggle and cve flag', () => {
    expect(argvFor('searchsploit', { query: 'apache', exact_title: true, cve: 'CVE-2021-44228' })).toEqual([
      '--json', '--exact', '--cve', 'CVE-2021-44228', 'apache',
    ])
    expect(argvFor('searchsploit', { query: 'openssh' })).toEqual(['--json', 'openssh'])
  })

  it('dalfox: skip_bav toggle', () => {
    expect(argvFor('dalfox', { skip_bav: true })).toContain('--skip-bav')
    expect(argvFor('dalfox', {})).not.toContain('--skip-bav')
  })

  it('netexec: username/password/local_auth/action', () => {
    expect(argvFor('netexec', {
      username: 'admin', password: 'pass', local_auth: true, action: '--shares',
    })).toEqual(['smb', 'target.tld', '-u', 'admin', '-p', 'pass', '--local-auth', '--shares'])
    expect(argvFor('netexec', {})).toEqual(['smb', 'target.tld'])
  })

  it('testssl: checks free-form string', () => {
    expect(argvFor('testssl', { checks: '--vulnerabilities' })).toEqual([
      '--jsonfile', '/dev/stdout', '--vulnerabilities', 'target.tld',
    ])
    expect(argvFor('testssl', {})).toEqual(['--jsonfile', '/dev/stdout', 'target.tld'])
  })

  it('enum4linux: username/password', () => {
    expect(argvFor('enum4linux', { username: 'admin', password: 'pass' })).toEqual([
      '-a', '-u', 'admin', '-p', 'pass', 'target.tld',
    ])
    expect(argvFor('enum4linux', {})).toEqual(['-a', 'target.tld'])
  })

  it('traceroute: protocol enum selects -I/-T or nothing', () => {
    expect((paramsOf('traceroute').protocol as { values: string[] }).values).toEqual(['udp', 'icmp', 'tcp'])
    expect(argvFor('traceroute', { protocol: 'icmp' })).toEqual(['-I', '-m', '30', 'target.tld'])
    expect(argvFor('traceroute', { protocol: 'tcp' })).toEqual(['-T', '-m', '30', 'target.tld'])
    expect(argvFor('traceroute', {})).toEqual(['-m', '30', 'target.tld'])
  })

  it('hydra: additional_flags inserted before target/service', () => {
    const base = { userlist: '/u.txt', passlist: '/p.txt', service: 'ssh' }
    expect(argvFor('hydra', { ...base, additional_flags: '-f' })).toEqual([
      '-L', '/u.txt', '-P', '/p.txt', '-t', '16', '-f', 'target.tld', 'ssh',
    ])
    expect(argvFor('hydra', base)).toEqual([
      '-L', '/u.txt', '-P', '/p.txt', '-t', '16', 'target.tld', 'ssh',
    ])
  })
})
