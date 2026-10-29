import { describe, expect, it } from 'vitest'
import { resolveLaunch, type LaunchHost } from './windows-launch.js'

const NPM = 'C:\\Users\\op\\AppData\\Roaming\\npm'
const LOCAL_BIN = 'C:\\Users\\op\\.local\\bin'
const SYSTEM = 'C:\\Windows\\System32'

/** A win32 host whose filesystem holds exactly `files` (path → contents). */
function windowsHost(files: Record<string, string>): LaunchHost {
  const lower = new Map(Object.entries(files).map(([path, body]) => [path.toLowerCase(), body]))
  return {
    platform: 'win32',
    isFile: (path) => lower.has(path.toLowerCase()),
    readFile: (path) => {
      const body = lower.get(path.toLowerCase())
      if (body === undefined) throw new Error(`ENOENT: ${path}`)
      return body
    },
  }
}

/** The shim npm writes for a package whose bin is a native executable. */
const nativeShim = (target: string): string =>
  ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', `"%dp0%\\${target}"   %*`].join('\r\n')

/** The shim npm writes for a package whose bin is a node script. */
const nodeShim = (script: string): string =>
  [
    '@ECHO off',
    'GOTO start',
    ':find_dp0',
    'SET dp0=%~dp0',
    'EXIT /b',
    ':start',
    'SETLOCAL',
    'CALL :find_dp0',
    '',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    '  SET PATHEXT=%PATHEXT:;.JS;=;%',
    ')',
    '',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${script}" %*`,
  ].join('\r\n')

const env = (path: string, pathext?: string): Record<string, string> => ({
  Path: path,
  ...(pathext !== undefined ? { PATHEXT: pathext } : {}),
})

describe('resolveLaunch', () => {
  it('leaves the command alone off Windows', () => {
    const host: LaunchHost = { platform: 'darwin', isFile: () => true, readFile: () => '' }
    expect(resolveLaunch('claude', ['--version'], env('/usr/bin'), host)).toEqual({ command: 'claude', args: ['--version'] })
  })

  it('resolves a bare name to the .exe on Path, as `where` does', () => {
    const host = windowsHost({ [`${LOCAL_BIN}\\claude.exe`]: '' })
    expect(resolveLaunch('claude', ['--resume', 'x'], env(`${SYSTEM};${LOCAL_BIN}`), host)).toEqual({
      command: `${LOCAL_BIN}\\claude.exe`,
      args: ['--resume', 'x'],
    })
  })

  it('searches the last Path entry too', () => {
    const host = windowsHost({ [`${LOCAL_BIN}\\claude.exe`]: '' })
    expect(resolveLaunch('claude', [], env(`${SYSTEM};${LOCAL_BIN}`), host).command).toBe(`${LOCAL_BIN}\\claude.exe`)
  })

  it('ignores the extensionless shell script npm writes next to the .cmd', () => {
    const host = windowsHost({
      [`${NPM}\\claude`]: '#!/bin/sh',
      [`${LOCAL_BIN}\\claude.exe`]: '',
    })
    expect(resolveLaunch('claude', [], env(`${NPM};${LOCAL_BIN}`), host).command).toBe(`${LOCAL_BIN}\\claude.exe`)
  })

  it('takes the first Path entry that has a match, trying PATHEXT in order within each', () => {
    const host = windowsHost({
      [`${NPM}\\claude.cmd`]: nativeShim('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'),
      [`${LOCAL_BIN}\\claude.exe`]: '',
    })
    const launch = resolveLaunch('claude', [], env(`${NPM};${LOCAL_BIN}`), host)
    expect(launch.command).toBe(`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`)
  })

  it('unwraps an npm shim that forwards to a native executable', () => {
    const host = windowsHost({
      [`${NPM}\\claude.cmd`]: nativeShim('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'),
    })
    expect(resolveLaunch('claude', ['task'], env(NPM), host)).toEqual({
      command: `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`,
      args: ['task'],
    })
  })

  it('unwraps an npm shim that runs a node script, using the node on Path', () => {
    const host = windowsHost({
      [`${NPM}\\gemini.cmd`]: nodeShim('node_modules\\@google\\gemini-cli\\dist\\index.js'),
      ['C:\\Program Files\\nodejs\\node.exe']: '',
    })
    expect(resolveLaunch('gemini', ['-p', 'hi'], env(`${NPM};C:\\Program Files\\nodejs`), host)).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: [`${NPM}\\node_modules\\@google\\gemini-cli\\dist\\index.js`, '-p', 'hi'],
    })
  })

  it('prefers the node.exe that sits next to the shim, as the shim itself does', () => {
    const host = windowsHost({
      [`${NPM}\\gemini.cmd`]: nodeShim('node_modules\\@google\\gemini-cli\\dist\\index.js'),
      [`${NPM}\\node.exe`]: '',
      ['C:\\Program Files\\nodejs\\node.exe']: '',
    })
    expect(resolveLaunch('gemini', [], env(`${NPM};C:\\Program Files\\nodejs`), host).command).toBe(`${NPM}\\node.exe`)
  })

  it('finds Path and PATHEXT whatever their case', () => {
    const host = windowsHost({ [`${LOCAL_BIN}\\claude.EXE`]: '' })
    // Windows paths are case-insensitive, so either spelling launches the same file.
    expect(resolveLaunch('claude', [], { PATH: LOCAL_BIN, pathext: '.EXE' }, host).command.toLowerCase()).toBe(
      `${LOCAL_BIN}\\claude.exe`.toLowerCase()
    )
  })

  it('falls back to the standard extensions when PATHEXT is unset', () => {
    const host = windowsHost({ [`${LOCAL_BIN}\\claude.exe`]: '' })
    expect(resolveLaunch('claude', [], env(LOCAL_BIN), host).command).toBe(`${LOCAL_BIN}\\claude.exe`)
  })

  it('never resolves to a script type CreateProcess cannot run', () => {
    const host = windowsHost({ [`${LOCAL_BIN}\\claude.js`]: '' })
    expect(resolveLaunch('claude', [], env(LOCAL_BIN, '.JS;.EXE'), host).command).toBe('claude')
  })

  it('accepts a name that already carries its extension', () => {
    const host = windowsHost({ [`${SYSTEM}\\WindowsPowerShell\\v1.0\\powershell.exe`]: '' })
    expect(resolveLaunch('powershell.exe', [], env(`${SYSTEM}\\WindowsPowerShell\\v1.0`), host).command).toBe(
      `${SYSTEM}\\WindowsPowerShell\\v1.0\\powershell.exe`
    )
  })

  it('leaves a path untouched', () => {
    const host = windowsHost({})
    const node = 'C:\\Program Files\\nodejs\\node.exe'
    expect(resolveLaunch(node, ['-v'], env(SYSTEM), host)).toEqual({ command: node, args: ['-v'] })
  })

  it('leaves a name it cannot find untouched, so the spawn reports it', () => {
    expect(resolveLaunch('claude', [], env(SYSTEM), windowsHost({}))).toEqual({ command: 'claude', args: [] })
  })

  it('leaves a batch file it cannot unwrap untouched rather than run it through cmd.exe', () => {
    const host = windowsHost({ [`${LOCAL_BIN}\\tool.cmd`]: '@echo off\r\necho hi' })
    expect(resolveLaunch('tool', [], env(LOCAL_BIN), host)).toEqual({ command: 'tool', args: [] })
  })
})
