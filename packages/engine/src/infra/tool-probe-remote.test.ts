import { describe, expect, it, vi } from 'vitest'
import type { BackendProfile } from '@exe/protocol'
import type { RunOutcome } from './backend-test.js'
import { parseProbeOutput, probeBackendTools, probeScript } from './tool-probe-remote.js'

const ssh: BackendProfile = {
  id: 'be-1',
  name: 'kali',
  kind: 'ssh',
  host: 'kali.lan',
  user: 'root',
  createdAt: '',
  updatedAt: '',
}

const docker: BackendProfile = {
  id: 'be-2',
  name: 'box',
  kind: 'docker',
  image: 'kalilinux/kali-rolling',
  createdAt: '',
  updatedAt: '',
}

/** A runner that returns a canned outcome and records what it was asked to run. */
function runner(outcome: Partial<RunOutcome>) {
  const calls: { program: string; args: string[]; timeout: number }[] = []
  const run = vi.fn(async (program: string, args: string[], timeout: number) => {
    calls.push({ program, args, timeout })
    return { code: 0, stdout: '', stderr: '', timedOut: false, ...outcome }
  })
  return { run, calls }
}

/** The stdout the remote script produces for the given rows. */
function stdout(rows: [string, string, string][]): string {
  return ['EXE_PROBE_BEGIN', ...rows.map((r) => r.join('\t'))].join('\n') + '\n'
}

describe('probeScript', () => {
  it('quotes program names so a hostile name cannot break out of the loop', () => {
    const script = probeScript(["nmap'; rm -rf /; echo '"])
    expect(script).toContain(`'nmap'\\''; rm -rf /; echo '\\'''`)
    expect(script).not.toMatch(/for p in nmap'; rm/)
  })

  it('guards --version with a timeout and /dev/null stdin so a tool cannot hang the batch', () => {
    const script = probeScript(['nmap'])
    expect(script).toContain('command -v timeout')
    expect(script).toContain('$EXE_TO "$p" --version')
    expect(script).toContain('</dev/null')
  })
})

describe('parseProbeOutput', () => {
  it('ignores anything before the marker, so an SSH banner never parses as a row', () => {
    const noisy = ['Welcome to Ubuntu 24.04', 'Last login: Tue', stdout([['nmap', '/usr/bin/nmap', 'Nmap version 7.94']])].join('\n')
    expect(parseProbeOutput(['nmap'], noisy)).toEqual([{ program: 'nmap', installed: true, version: 'nmap 7.94' }])
  })

  it('reads an empty path as missing and keeps the requested order', () => {
    const out = stdout([
      ['whois', '', ''],
      ['nmap', '/usr/bin/nmap', 'Nmap version 7.94'],
    ])
    expect(parseProbeOutput(['nmap', 'whois'], out)).toEqual([
      { program: 'nmap', installed: true, version: 'nmap 7.94' },
      { program: 'whois', installed: false, version: null },
    ])
  })

  it('reports an installed tool with no parseable version as installed, version null', () => {
    const out = stdout([['httpx', '/usr/bin/httpx', '']])
    expect(parseProbeOutput(['httpx'], out)).toEqual([{ program: 'httpx', installed: true, version: null }])
  })

  it('treats a program the script never reported as missing rather than installed', () => {
    const out = stdout([['nmap', '/usr/bin/nmap', 'Nmap version 7.94']])
    expect(parseProbeOutput(['nmap', 'amass'], out)[1]).toEqual({ program: 'amass', installed: false, version: null })
  })
})

describe('probeBackendTools', () => {
  it('checks the whole catalog over ONE ssh invocation', async () => {
    const { run, calls } = runner({ stdout: stdout([['nmap', '/usr/bin/nmap', 'Nmap version 7.94'], ['whois', '', '']]) })
    const result = await probeBackendTools(ssh, ['nmap', 'whois'], run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(calls[0]!.program).toBe('ssh')
    expect(calls[0]!.args.at(-2)).toBe('root@kali.lan')
    expect(result.error).toBeUndefined()
    expect(result.rows).toEqual([
      { program: 'nmap', installed: true, version: 'nmap 7.94' },
      { program: 'whois', installed: false, version: null },
    ])
  })

  it('runs one throwaway container for a docker backend', async () => {
    const { run, calls } = runner({ stdout: stdout([['nmap', '/usr/bin/nmap', '7.94']]) })
    await probeBackendTools(docker, ['nmap'], run)

    expect(run).toHaveBeenCalledTimes(1)
    expect(calls[0]!.program).toBe('docker')
    expect(calls[0]!.args.slice(0, 3)).toEqual(['run', '--rm', '-i'])
    expect(calls[0]!.args).toContain('kalilinux/kali-rolling')
  })

  it('reports a connection failure as an error, never as a catalog of missing tools', async () => {
    const { run } = runner({ code: 255, stderr: 'ssh: connect to host kali.lan port 22: No route to host' })
    const result = await probeBackendTools(ssh, ['nmap', 'whois'], run)

    expect(result.rows).toEqual([])
    expect(result.error).toBe('ssh: connect to host kali.lan port 22: No route to host')
  })

  it('treats output without the marker as a failed connection', async () => {
    const { run } = runner({ code: 0, stdout: 'bash: sh: command not found\n' })
    const result = await probeBackendTools(ssh, ['nmap'], run)
    expect(result.rows).toEqual([])
    expect(result.error).not.toBeUndefined()
  })

  it('names a timeout when the host gave us nothing to report', async () => {
    const { run } = runner({ code: null, timedOut: true })
    expect((await probeBackendTools(ssh, ['nmap'], run)).error).toBe('the connection timed out')
  })

  it('never spawns anything for an empty program list', async () => {
    const { run } = runner({})
    expect(await probeBackendTools(ssh, [], run)).toEqual({ rows: [] })
    expect(run).not.toHaveBeenCalled()
  })
})
