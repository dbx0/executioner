#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { startHost } from './host.js'

function usage(): never {
  console.error(`usage:
  executioner-host serve [--bind 127.0.0.1:47821] [--token <bootstrap>] [--open]

Start the team server (engine supervisor + portable UI).
Prints the bootstrap token once. Open the printed URL in a browser.
Pass --open on macOS to launch the default browser at that URL.
Native folder and photo dialogs require macOS (Darwin).`)
  process.exit(2)
}

function parseBind(raw: string | undefined): { host: string; port: number } {
  const value = raw ?? '127.0.0.1:47821'
  const idx = value.lastIndexOf(':')
  if (idx <= 0) usage()
  const host = value.slice(0, idx)
  const port = Number(value.slice(idx + 1))
  if (!Number.isInteger(port) || port <= 0) usage()
  return { host, port }
}

/** Open the portable UI in the default browser (macOS `open`, else xdg-open / start). */
function openPortableUi(url: string): void {
  const platform = process.platform
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  if (cmd !== 'serve') usage()

  let bindRaw: string | undefined
  let token: string | undefined
  let openBrowser = false
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--bind') {
      bindRaw = argv[++i]
      continue
    }
    if (arg === '--token') {
      token = argv[++i]
      continue
    }
    if (arg === '--open') {
      openBrowser = true
      continue
    }
    usage()
  }

  if (token === undefined || token === '') {
    const fromEnv = process.env.EXECUTIONER_HOST_TOKEN
    if (fromEnv !== undefined && fromEnv !== '') token = fromEnv
  }

  const bind = parseBind(bindRaw)
  const host = await startHost({
    host: bind.host,
    port: bind.port,
    ...(token !== undefined && token !== '' ? { bootstrapToken: token } : {}),
  })

  const portableUi = `${host.url}/?token=${encodeURIComponent(host.bootstrapToken)}`
  console.log(`executioner-host listening on ${host.url}`)
  console.log(`bootstrap token: ${host.bootstrapToken}`)
  console.log(`portable UI: ${portableUi}`)
  console.log('engines stay up when the browser tab closes (Cobalt Strike–style).')
  if (openBrowser) openPortableUi(portableUi)

  const shutdown = () => {
    void host.stop().finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
