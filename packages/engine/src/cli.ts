#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import { createProject, openProject, scaffoldEngagement, readConfig, writeConfig } from '@exe/project'
import { backendProfileInputSchema, formatHandshake } from '@exe/protocol'
import { NodeRegistry, loadManifests, bundledManifestsDir } from '@exe/nodes'
import { PtyRegistry } from '@exe/pty'
import { testBackend } from './infra/backend-test.js'
import { enrollSshKey } from './infra/ssh-enroll.js'
import { generateToken } from './transport/auth.js'
import { EventBus } from './transport/events.js'
import { Executor } from './execution/executor.js'
import { CancellationRegistry } from './execution/cancellation.js'
import { createApp } from './transport/server.js'
import { attachEventSocket } from './transport/ws.js'
import { attachPtySocket } from './transport/pty-ws.js'

const VERSION = '0.0.1'

const USAGE = `executioner <command>

Commands:
  init <dir> --name <name> [--icon <emoji>] [--description <text>] [--scope <text>]
                             Create an engagement folder (scaffolds the bug-bounty
                             methodology structure: recon/vuln/notes/evidence,
                             HUNT.md, docs/SCOPE.md)
  serve <dir>                Start the engine for an engagement folder
  backend-test [--create-workdir]
                             Read a backend profile as JSON on stdin, run its
                             liveness test and print the result as JSON. Stateless:
                             needs no engagement, so the desktop app can verify a
                             connection before one exists.
  ssh-enroll --key-dir <dir> Read {host,user,password,port?} as JSON on stdin,
                             generate a keypair under <dir>, install it with the
                             password and print the result as JSON. Also stateless.

Both stateless commands take their input on stdin rather than argv so a password
never appears in the process list.

The serve command binds 127.0.0.1 on a random port and prints a handshake line
on stdout containing the port and a per-launch bearer token.
`

/** Read all of stdin as UTF-8 — how the stateless commands take their input. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, dir] = argv

  if (command === undefined || command === '--help' || command === '-h') {
    process.stdout.write(USAGE)
    return 0
  }

  if (command === 'backend-test' || command === 'ssh-enroll') {
    let input: unknown
    try {
      input = JSON.parse(await readStdin())
    } catch {
      process.stderr.write('error: expected a JSON object on stdin\n')
      return 1
    }
    if (command === 'backend-test') {
      const parsed = backendProfileInputSchema.safeParse(input)
      if (!parsed.success) {
        process.stderr.write('error: invalid backend profile\n')
        return 1
      }
      const result = await testBackend(parsed.data, undefined, {
        createWorkdir: argv.includes('--create-workdir'),
      })
      process.stdout.write(`${JSON.stringify(result)}\n`)
      return 0
    }
    const keyDir = flag(argv, '--key-dir')
    if (keyDir === undefined) {
      process.stderr.write('error: ssh-enroll requires --key-dir\n')
      return 1
    }
    const body = input as { host?: unknown; user?: unknown; password?: unknown; port?: unknown }
    const host = typeof body.host === 'string' ? body.host.trim() : ''
    const user = typeof body.user === 'string' ? body.user.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (host === '' || user === '' || password === '') {
      process.stderr.write('error: host, user and password are required\n')
      return 1
    }
    const port = typeof body.port === 'number' && Number.isFinite(body.port) ? body.port : undefined
    const result = await enrollSshKey({ host, user, password, keyDir, ...(port !== undefined ? { port } : {}) })
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return 0
  }

  if (dir === undefined) {
    process.stderr.write(`error: ${command} requires a directory\n`)
    return 1
  }

  if (command === 'init') {
    const name = flag(argv, '--name')
    if (name === undefined) {
      process.stderr.write('error: init requires --name\n')
      return 1
    }
    const icon = flag(argv, '--icon')
    const description = flag(argv, '--description')
    const scope = flag(argv, '--scope')
    try {
      createProject(dir, { name }).close()
      // Persist the emoji icon alongside the name (optional).
      if (icon !== undefined && icon !== '') {
        writeConfig(dir, { ...readConfig(dir), icon })
      }
      // Lay out the deterministic bug-bounty methodology structure.
      scaffoldEngagement(dir, {
        name,
        ...(description !== undefined ? { description } : {}),
        ...(scope !== undefined ? { scope } : {}),
      })
      process.stdout.write(`Created engagement ${name} in ${dir}\n`)
      return 0
    } catch (error) {
      process.stderr.write(`error: ${(error as Error).message}\n`)
      return 1
    }
  }

  if (command === 'serve') {
    let project
    try {
      project = openProject(dir)
    } catch (error) {
      process.stderr.write(`error: ${(error as Error).message}\n`)
      return 1
    }

    // Anything still marked running belongs to a previous engine that is no
    // longer alive; settle it now so the runs list doesn't show a phantom job.
    const stale = project.runs.reconcileInterrupted(
      'interrupted: the engine stopped while this run was in progress',
    )
    if (stale > 0) {
      process.stderr.write(`[executioner] closed ${String(stale)} run(s) interrupted by a previous shutdown\n`)
    }

    const token = generateToken()
    const bus = new EventBus()
    const registry = new NodeRegistry(loadManifests(bundledManifestsDir()))
    // Shared with the app so a standalone run started through the executor is
    // stoppable by the same cancel route that stops workflow runs.
    const runs = new CancellationRegistry()
    const executor = new Executor(project, bus, runs)
    const ptyRegistry = new PtyRegistry()
    // Port is unknown until the server binds below; the app reads it lazily
    // through this mutable holder when it builds argv for spawned agents.
    const connection = { port: 0, token }
    const app = createApp({ project, token, bus, registry, executor, runs, ptyRegistry, connection })

    const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
      const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(s))
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      process.stderr.write('error: could not determine listening port\n')
      return 1
    }
    connection.port = address.port

    // Now that the server is bound and workflows can run, start the workflow
    // scheduler: enabled interval schedules begin ticking (on_create schedules
    // fire live from the target-create route).
    app.scheduler.start()

    attachEventSocket(server as unknown as import('node:http').Server, bus, token)
    attachPtySocket(server as unknown as import('node:http').Server, ptyRegistry, token)

    process.stdout.write(
      `${formatHandshake({
        port: address.port,
        token,
        pid: process.pid,
        projectRoot: project.root,
        version: VERSION,
      })}\n`,
    )

    const shutdown = () => {
      app.scheduler.stop()
      executor.stopAll()
      ptyRegistry.killAll()
      server.close()
      project.close()
      process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)

    return await new Promise<number>(() => {
      // Resolves never: the process lives until a signal arrives.
    })
  }

  process.stderr.write(`error: unknown command ${command}\n${USAGE}`)
  return 1
}

// Only run when invoked directly, so importing this module in tests is inert.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code)
  })
}
