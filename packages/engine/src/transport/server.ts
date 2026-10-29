import { rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { graphSchema } from '@exe/graph'
import type { Project } from '@exe/project'
import type { NodeRegistry } from '@exe/nodes'
import { agentAdapters, type PtyRegistry } from '@exe/pty'
import { newId } from '@exe/protocol'
import { bearerAuth, isAllowedOrigin, loopbackHostOnly } from './auth.js'
import { AgentTokenRegistry } from './agent-tokens.js'
import type { EventBus } from './events.js'
import { publishChanges } from './change-events.js'
import type { Executor } from '../execution/executor.js'
import { AgentRunner } from '../agents/agent-runner.js'
import { AssistantRunner } from '../agents/assistant-runner.js'
import { assistantRoutes } from '../routes/assistant.js'
import { GraphExecutor } from '../execution/graph-executor.js'
import { CancellationRegistry } from '../execution/cancellation.js'
import { healthRoutes } from '../routes/health.js'
import { targetRoutes } from '../routes/targets.js'
import { projectRoutes } from '../routes/project.js'
import { overviewRoutes } from '../routes/overview.js'
import { nodeRoutes } from '../routes/nodes.js'
import { executionRoutes } from '../routes/executions.js'
import { workflowRoutes } from '../routes/workflows.js'
import { backendRoutes } from '../routes/backends.js'
import { customNodeRoutes } from '../routes/custom-nodes.js'
import { buildManifestMap } from '../infra/manifests.js'
import { shQuote } from '../infra/launcher.js'
import { secretRoutes } from '../routes/secrets.js'
import { findingRoutes } from '../routes/findings.js'
import { agentRoutes } from '../routes/agents.js'
import { agentModelsRoutes } from '../routes/agent-models.js'
import { toolRoutes } from '../routes/tools.js'
import { filesRoutes } from '../routes/files.js'
import { gitRoutes } from '../routes/git.js'
import { sessionRoutes } from '../routes/sessions.js'
import { usageRoutes } from '../routes/usage.js'
import { skillRoutes } from '../routes/skills.js'
import { readSkillsConfig, writeClaudeSkillsPlugin } from '../infra/skills.js'
import { usageLimitsRoutes } from '../routes/usage-limits.js'
import { logsRoutes } from '../routes/logs.js'
import { scheduleRoutes } from '../routes/schedules.js'
import { savedAgentRoutes } from '../routes/saved-agents.js'
import { SavedAgentsStore } from '../agents/saved-agents-store.js'
import { Scheduler } from '../execution/scheduler.js'
import { terminalRoutes, type TerminalCreator } from '../routes/terminals.js'
import {
  PROFILE_TOOLS,
  ProjectToolset,
  firesOnCreate,
  type AgentProfile,
  type ToolName,
  type ToolsetDeps,
} from '../mcp/toolset.js'
import { scopeRoutes, type RunAgentFactory } from '../routes/scope.js'
import { scopeRuleRoutes } from '../routes/scope-rules.js'
import { buildScopePrompt } from '../agents/agent-scope-runner.js'
import { mcpRoute } from '../mcp/route.js'
import { claudeAllowedTools, writeAgentBriefingFile, writeAgentMcpConfig } from '../mcp/agent-config.js'
import { buildAgentMcpInjection, isMcpInjectableAgent, type McpInjection } from '../mcp/agent-mcp-injection.js'
import { isAgentWiringEnabled, readAgentMcpWiring } from '../infra/agent-mcp.js'
import { agentMcpRoutes } from '../routes/agent-mcp.js'
import { buildProjectBriefing } from '../agents/project-briefing.js'
import { contextFileForAgent, writeBriefingContextBlock } from '../agents/agent-context-file.js'
import { ensureEngagementMemory } from '../agents/agent-memory.js'
import { CLAUDE_SESSION_MARKERS } from '../agents/agent-env.js'
import { LaunchCleanup, type DeferCleanup } from '../agents/launch-cleanup.js'
import { HEADLESS_CLI_RESTRICTION, codexHeadlessFlags, headlessCliLaunch } from '../agents/headless-cli.js'
import { writeAgentHookConfig } from '../mcp/agent-hook-config.js'
import { agentHookRoutes } from '../routes/agent-hooks.js'
import { TranscriptWatchers } from '../infra/transcript-watch.js'
import {
  isTeamAgent,
  teamBaseOf,
  resolveTeam,
  buildAgentsPayload,
  buildAgentsPayloadFromMembers,
  type AgentDefinition,
} from '../agents/agent-team.js'
import { writeOpencodeTeamAgents } from '../agents/opencode-agents.js'
import type { SavedAgent, SavedAgentMember } from '@exe/db'
import { teamRoutes } from '../routes/teams.js'

export interface AppOptions {
  project: Project
  token: string
  bus: EventBus
  registry: NodeRegistry
  executor: Executor
  /**
   * The registry the `executor` was built with, so a standalone run started
   * through it is stoppable by the cancel route. Omitted, the app makes its own
   * and only graph runs are cancellable — which is what tests want.
   */
  runs?: CancellationRegistry
  agentRunner?: AgentRunner
  createTerminal?: TerminalCreator
  ptyRegistry?: PtyRegistry
  /** Filled in by the caller after the http server binds; port may start at 0. */
  connection?: { port: number; token: string }
  /** The scoped tokens issued to spawned agents. Injectable for tests. */
  agentTokens?: AgentTokenRegistry
}

/**
 * The /api routes a scoped agent token may call: the hook forwarder's event
 * post. Everything else under /api needs the master token.
 */
const AGENT_API_ROUTES: ReadonlySet<string> = new Set(['POST /api/agent-events'])

/**
 * A headless agent's token is revoked when its process exits; this caps its
 * life should that exit never be seen. Interactive tokens have no cap, since a
 * terminal may stay open for days, and end with the terminal.
 */
const HEADLESS_TOKEN_TTL_MS = 6 * 60 * 60 * 1000

/** The engine app, with the workflow Scheduler the caller starts once bound. */
export type EngineApp = Hono & { scheduler: Scheduler }

export function createApp(options: AppOptions): EngineApp {
  const app = new Hono()

  // A browser page can only reach this engine by naming it, so anything that
  // arrives under another hostname is a DNS-rebinding attempt.
  app.use('*', loopbackHostOnly())

  // The Electron renderer talks to this loopback engine cross-origin: its
  // origin is the Vite dev server on loopback in dev and file:// ("null") when
  // packaged. Only those get a CORS grant; any other web page the operator has
  // open cannot read a response, and every /api route is bearer-guarded too.
  app.use(
    '*',
    cors({
      origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  )

  // An unexpected throw answers with a generic JSON error: the message of an
  // fs, SQLite or parser error can carry absolute paths and internals, so it
  // goes to the engine log rather than to the client.
  app.onError((err, c) => {
    process.stderr.write(`[executioner] ${c.req.method} ${c.req.path} failed: ${err.stack ?? err.message}\n`)
    return c.json({ error: 'internal error' }, 500)
  })

  app.route('/', healthRoutes())

  const mcpStore = options.project.runs

  // One registry for the whole engine: a run is stoppable through the same call
  // whether the run route, the scheduler, the /mcp tool or a standalone Tools
  // run started it. The caller passes the one the executor already holds.
  const runs = options.runs ?? new CancellationRegistry()

  // Read per request: the port is 0 until the server binds.
  const bound = options.connection
  const enginePort = bound !== undefined ? (): number => bound.port : undefined

  // Built once and shared: the /mcp ProjectToolset and the executor's
  // AgentRunner both read/write through this same deps object. An agent's
  // set_node_output call lands in the run bound to its own token's session
  // (deps.sessions), never in whichever node happens to be running.
  /**
   * Load a saved workflow graph and run it through a fresh GraphExecutor.
   * Shared by the /mcp run tool and the Scheduler so both take the identical
   * path: bundled + custom nodes are merged fresh per run, so custom nodes are
   * runnable without a restart.
   */
  const runGraphWorkflow = async (workflowId: string, targetId: string | null) => {
    const workflow = options.project.workflows.get(workflowId)
    if (workflow === undefined) throw new Error(`unknown workflow: ${workflowId}`)
    const graph = graphSchema.parse(JSON.parse(workflow.graph))
    const executor = new GraphExecutor({
      project: options.project,
      bus: options.bus,
      manifests: buildManifestMap(options.registry, options.project),
      store: mcpStore,
      runs,
      ...(enginePort !== undefined ? { enginePort } : {}),
    })
    return executor.run({ graph, workflowId, targetId, testMode: false })
  }

  const toolsetDeps: ToolsetDeps = {
    project: options.project,
    // Reads the shared executions tables so the assistant can inspect past runs.
    executionStore: mcpStore,
    // Fresh each call so newly-created custom nodes appear in the assistant's
    // node-type catalog without a restart.
    manifests: () => [...buildManifestMap(options.registry, options.project).values()],
    runWorkflow: async (workflowId, targetId) => {
      const result = await runGraphWorkflow(workflowId, targetId)
      return { executionId: result.executionId, status: result.status === 'succeeded' ? 'success' : 'error' }
    },
  }

  // Fires interval + on_create workflow triggers. Runs workflows through the
  // same GraphExecutor path as the /mcp run tool and the run route. The caller
  // (serve) calls scheduler.start() after the http server binds; on_create is
  // driven live by the project.targets.upsert wrap below.
  const scheduler = new Scheduler({
    project: options.project,
    runWorkflow: runGraphWorkflow,
  })

  // Publish coalesced `change` events so the renderer refetches live. Installed
  // before the on_create wrap below so that wrap sits on top of it.
  publishChanges(options.project, options.bus)

  // Drive `on_create` schedules from EVERY genuine target creation, not just the
  // POST /targets route. Tool nodes discover targets by calling
  // `project.targets.upsert` directly (subdomain enumeration, port scans, etc.),
  // bypassing the HTTP route entirely; without this wrap those newly-discovered
  // targets would never fire on_create. Wrapping the shared repository instance
  // catches the route, the executor, graph nodes and the /mcp add_target tool in
  // one place. Re-discovery (an already-known target) does not fire. The
  // Scheduler suppresses cascades from within its own runs (see scheduledRun).
  // A target a headless agent recorded does not fire either (see
  // HEADLESS_AGENT_TARGET_SOURCE): a prompt-injected agent must not be able to
  // aim saved workflows at a host of its choosing. The operator sees the
  // target, marked with that source, and runs a workflow on it by hand.
  {
    const targets = options.project.targets
    const upstream = targets.upsert.bind(targets)
    targets.upsert = (input) => {
      const isNew = targets.findByValue(input.kind, input.value) === undefined
      const target = upstream(input)
      if (isNew && firesOnCreate(input.source)) void scheduler.onTargetCreated(target)
      return target
    }
  }

  const ptyRegistry = options.ptyRegistry
  const connection = options.connection
  const agentTokens = options.agentTokens ?? new AgentTokenRegistry()

  // Every spawned agent gets its own scoped token, never the master token: it
  // opens the MCP endpoint with its profile's tools and the hook event post for
  // its own session, and nothing else.
  const issueAgentToken = (profile: AgentProfile, sessionId?: string) =>
    agentTokens.issue({
      profile,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(profile === 'interactive' ? {} : { ttlMs: HEADLESS_TOKEN_TTL_MS }),
    })

  /**
   * Issue a scoped token for one Claude launch, bound to `session.id`, and
   * write the MCP config (and, with `hooks`, the hook settings) that carry it.
   * The cleanup handed to `defer` revokes the token and deletes those files
   * once the agent exits; it is registered before anything is written, so a
   * throw part way through still leaves nothing behind.
   */
  function claudeLaunchFiles(
    port: number,
    profile: AgentProfile,
    defer: DeferCleanup,
    session: { id: string; hooks: true },
  ): { mcpConfig: string; settings: string }
  function claudeLaunchFiles(
    port: number,
    profile: AgentProfile,
    defer: DeferCleanup,
    session: { id: string; hooks?: false },
  ): { mcpConfig: string }
  function claudeLaunchFiles(
    port: number,
    profile: AgentProfile,
    defer: DeferCleanup,
    session: { id: string; hooks?: boolean },
  ): { mcpConfig: string; settings?: string } {
    const issued = issueAgentToken(profile, session.id)
    const dirs: string[] = []
    defer(() => {
      issued.revoke()
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
    })
    const mcpConfig = writeAgentMcpConfig({ port, token: issued.token })
    dirs.push(dirname(mcpConfig))
    if (session.hooks !== true) return { mcpConfig }
    const settings = writeAgentHookConfig({ port, token: issued.token, sessionId: session.id })
    dirs.push(dirname(settings))
    return { mcpConfig, settings }
  }

  // The per-launch injection (project MCP + engagement briefing) for a
  // non-Claude agent that reads its config from env/flags — opencode today.
  // Gated by the per-agent wiring toggle (default on); returns undefined when
  // the agent is not injectable, the toggle is off, or there is no connection.
  // The briefing is the same orientation Claude gets via --append-system-prompt,
  // delivered through the agent's own system-prompt channel (opencode
  // `instructions`). Best-effort throughout: nothing here blocks a spawn.
  const agentLaunchInjection = (
    agent: string,
    profile: AgentProfile,
    sessionId: string,
    defer: DeferCleanup,
  ): McpInjection | undefined => {
    if (connection === undefined) return undefined
    if (agent === 'claude' || !isMcpInjectableAgent(agent)) return undefined
    // The MCP server is gated by the wiring toggle; the briefing (context) is
    // not — an agent always gets oriented, and the briefing is rendered to match
    // whether it actually has the toolset.
    const wired = isAgentWiringEnabled(readAgentMcpWiring(), agent)
    const instructionsFiles: string[] = []
    try {
      const memoryDir = ensureEngagementMemory(options.project.root, options.project.config.name)
      // The briefing names exactly the tools this launch's profile has.
      const briefing = buildProjectBriefing(options.project, memoryDir, wired ? { profile } : { mcp: false })
      instructionsFiles.push(writeAgentBriefingFile(briefing, options.project.root, profile))
    } catch {
      /* launch without the briefing rather than not at all */
    }
    const headless = profile !== 'interactive'
    let mcp: { port: number; token: string; tools?: readonly ToolName[] } | undefined
    if (wired) {
      const issued = issueAgentToken(profile, sessionId)
      defer(issued.revoke)
      mcp = { port: connection.port, token: issued.token, ...(headless ? { tools: PROFILE_TOOLS[profile] } : {}) }
    }
    return buildAgentMcpInjection(agent, {
      ...(mcp !== undefined ? { mcp } : {}),
      ...(instructionsFiles.length > 0 ? { instructionsFiles } : {}),
      ...(headless ? { headless } : {}),
    })
  }

  // Deliver the engagement briefing to an agent that has no system-prompt flag
  // and instead reads a working-directory context file (codex/gemini/cursor/
  // hermes → AGENTS.md / GEMINI.md). Written into the agent's launch `cwd` as a
  // managed block that coexists with the user's file and the skills block. These
  // agents don't carry the MCP toolset, so the briefing is rendered MCP-free.
  // Best-effort and unconditional: context does not depend on the MCP toggle.
  const writeAgentContext = (agent: string, cwd: string): void => {
    const filename = contextFileForAgent(agent)
    if (filename === undefined) return
    try {
      const memoryDir = ensureEngagementMemory(options.project.root, options.project.config.name)
      const briefing = buildProjectBriefing(options.project, memoryDir, { mcp: false })
      writeBriefingContextBlock(cwd, filename, briefing)
    } catch {
      /* context is best-effort; never block the spawn */
    }
  }

  // One saved-agents store shared by the CRUD routes and the team launcher, so a
  // team's edited roster is what actually gets passed to `claude --agents`.
  const savedAgentsStore = new SavedAgentsStore()

  /**
   * The saved roster for a team `agent` string (`<base>-team:<id>`), matched
   * across the local DB and the global file, or undefined when none is found.
   */
  const findTeamMembers = (agentStr: string): SavedAgentMember[] | undefined => {
    let global: SavedAgent[]
    try {
      global = savedAgentsStore.list()
    } catch {
      global = []
    }
    const saved = [...options.project.savedAgents.list(), ...global].find(
      (a) => a.agent === agentStr && a.members !== undefined && a.members.length > 0,
    )
    return saved?.members !== undefined && saved.members.length > 0 ? saved.members : undefined
  }

  /**
   * Resolve the `--agents` payload for a Claude team launch. Prefers the saved
   * team's edited roster; falls back to the built-in constant when none is found,
   * so a launch never dies.
   */
  const resolveTeamAgents = (agentStr: string): Record<string, AgentDefinition> => {
    const members = findTeamMembers(agentStr)
    return members !== undefined ? buildAgentsPayloadFromMembers(members) : buildAgentsPayload(resolveTeam(agentStr))
  }

  // When the caller supplies a pty registry and connection info (the real
  // `serve` command), build the internal AgentRunner from the shared
  // toolsetDeps so agent nodes reach the same MCP-backed project as /mcp.
  const agentRunner: AgentRunner | undefined =
    options.agentRunner ??
    (ptyRegistry !== undefined && connection !== undefined
      ? new AgentRunner({
          bus: options.bus,
          project: options.project,
          registry: ptyRegistry,
          toolsetDeps,
          buildArgv: ({ prompt, agent, sessionId, allowUnrestrictedCli, defer }) => {
            const requested = agent ?? 'claude'
            // An unknown name runs claude, as the adapter lookup always has.
            const name = HEADLESS_CLI_RESTRICTION[requested] === undefined ? 'claude' : requested
            // Every other CLI runs with its own shell, edit and web tools locked
            // down as far as it allows, or is refused (see headless-cli.ts).
            if (name !== 'claude') return headlessCliLaunch(name, prompt, { allowUnrestricted: allowUnrestrictedCli, defer })
            const { mcpConfig } = claudeLaunchFiles(connection.port, 'workflow', defer, { id: sessionId })
            // Pre-allow the workflow profile's tools one by one so set_node_output
            // isn't denied in headless mode while run_command stays denied.
            // --allowedTools is variadic, so keep --mcp-config last.
            return ['claude', '-p', prompt, '--allowedTools', ...claudeAllowedTools('workflow'), '--mcp-config', mcpConfig]
          },
          // Env-based MCP + briefing injection for non-Claude agents (opencode
          // today). Claude is wired via flags above; this covers the agents that
          // read their config from env, sharing the terminal path's helper.
          buildEnv: ({ agent, sessionId, defer }) => agentLaunchInjection(agent ?? 'claude', 'workflow', sessionId, defer)?.env,
        })
      : undefined)

  // The AI workflow assistant runner: spawns the selected agent headless with
  // the project MCP config and the SAME shared toolsetDeps, so its
  // list_node_types/get_workflow_graph/propose_workflow MCP calls reach this
  // project. Only Claude speaks our --mcp-config toolset (so it can propose);
  // Codex runs headless best-effort and its stdout is taken as advice only.
  const assistantRunner: AssistantRunner | undefined =
    ptyRegistry !== undefined && connection !== undefined
      ? new AssistantRunner({
          registry: ptyRegistry,
          toolsetDeps,
          cwd: options.project.root,
          buildArgv: ({ prompt, agent, resume, sessionId, defer }) => {
            if (agent === 'codex') {
              // Best-effort headless Codex: no MCP wiring, advice only, and its
              // own shell, writes, network and user MCP servers locked down
              // like a codex agent node.
              return resume !== undefined && resume !== ''
                ? ['codex', 'exec', 'resume', ...codexHeadlessFlags(), resume, prompt]
                : ['codex', 'exec', '--sandbox', 'read-only', ...codexHeadlessFlags(), '--', prompt]
            }
            const { mcpConfig } = claudeLaunchFiles(connection.port, 'assistant', defer, { id: sessionId })
            // `--mcp-config <configs...>` is variadic: it consumes every arg that
            // follows it, so the prompt must NOT come after it (else Claude reads
            // the prompt as a config file path — ENAMETOOLONG). Pass the prompt as
            // the positional right after -p and keep --mcp-config last (the proven
            // order the agent-node runner uses).
            const base = ['claude', '-p', prompt, '--output-format', 'json']
            const withResume = resume !== undefined && resume !== '' ? [...base, '--resume', resume] : base
            // Headless claude has no interactive approval, so pre-allow the
            // assistant profile's tools by name or every tool call is denied.
            // --allowedTools is also variadic, so keep --mcp-config last.
            return [...withResume, '--allowedTools', ...claudeAllowedTools('assistant'), '--mcp-config', mcpConfig]
          },
        })
      : undefined

  const createTerminal: TerminalCreator | undefined =
    options.createTerminal ??
    (ptyRegistry !== undefined && connection !== undefined
      ? ({ kind, agent, resume, prompt }) => {
          const id = newId()
          if (kind === 'shell') {
            // A plain interactive shell in the engagement directory.
            const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
            ptyRegistry.create(id, {
              command: shell,
              args: [],
              cwd: options.project.root,
              unsetEnv: CLAUDE_SESSION_MARKERS,
            })
            return { id }
          }
          const isTeam = isTeamAgent(agent)
          // A team launches its base CLI (claude or opencode); a plain agent runs
          // its own CLI. Claude and Claude teams take the Claude Code flag tail.
          const teamBase = isTeam ? teamBaseOf(agent ?? '') : undefined
          const adapterName = isTeam ? teamBase ?? 'claude' : agent ?? 'claude'
          const adapter = agentAdapters[adapterName] ?? agentAdapters.claude
          if (adapter === undefined) throw new Error('claude agent adapter is not registered')
          const isClaude = adapterName === 'claude'
          // `--mcp-config`, `--settings` (hooks) and `--agents` are Claude Code
          // flags. Appending them to another agent's CLI (codex, gemini, …) makes
          // it error out and exit — the tab would blink and close. So only Claude
          // (and Claude teams, which launch the claude CLI) get this tail.
          const tail: string[] = []
          // The terminal's scoped token and its temp files end with the terminal.
          // Every launch below goes through `spawn`, which also strips the
          // launching session's Claude markers. Until a pty is running, the
          // `finally` below owns the cleanup: any throw between issuing the
          // token and the spawn (a briefing, a team roster, the spawn itself)
          // revokes it there instead of leaving it valid until a restart.
          const cleanup = new LaunchCleanup()
          let spawned = false
          const spawn = (spawnOptions: Omit<Parameters<typeof ptyRegistry.create>[1], 'unsetEnv'>): void => {
            ptyRegistry.create(id, { ...spawnOptions, unsetEnv: CLAUDE_SESSION_MARKERS }).onExit(cleanup.run)
            spawned = true
          }
          try {
            if (isClaude) {
              // Hooks report the agent's lifecycle (and its sub-agents) back so the
              // desktop can show real status. The operator watches this terminal,
              // so it gets the interactive profile: every tool, behind Claude's
              // own permission prompts.
              const { mcpConfig, settings } = claudeLaunchFiles(connection.port, 'interactive', cleanup.defer, { id, hooks: true })
              tail.push('--mcp-config', mcpConfig, '--settings', settings)
              // Tell the agent what engagement it is in: which backends it can run
              // on, what is already in the inventory, and that the MCP server holds
              // the live state. Without it the agent has the tools but no reason to
              // call them, so it starts blind in the engagement directory.
              // Best-effort — a briefing that cannot be built never blocks a spawn.
              try {
                // Seed the engagement's memory index before briefing the agent
                // about it, so it finds an empty index rather than a missing file.
                const memoryDir = ensureEngagementMemory(options.project.root, options.project.config.name)
                tail.push('--append-system-prompt', buildProjectBriefing(options.project, memoryDir))
              } catch {
                /* launch without the briefing rather than not at all */
              }
              if (isTeam) tail.push('--agents', JSON.stringify(resolveTeamAgents(agent ?? 'claude-team')))
            }
            // An opencode team reads its roster from `.opencode/agent/*.md` in the
            // engagement dir (opencode has no inline flag), so materialise the saved
            // members there before launch. Best-effort: never block the spawn.
            if (isTeam && teamBase === 'opencode') {
              try {
                const members = findTeamMembers(agent ?? '')
                if (members !== undefined) writeOpencodeTeamAgents(options.project.root, members)
              } catch {
                /* roster write is best-effort */
              }
            }
            // Agent Skills: when a skills folder is configured and this agent is
            // enabled, append the native skill flag. Claude (incl. teams) loads
            // skills from a wrapped plugin (--plugin-dir); Hermes takes --skills
            // directly. Guard all fs so a skills failure never breaks the launch.
            try {
              // A team uses its base CLI's skills toggle (claude teams → claude).
              const skillAgentId = isTeam ? teamBase ?? 'claude' : agent ?? ''
              const skillsCfg = readSkillsConfig(options.project.root)
              if (skillsCfg.folder !== null && skillsCfg.enabled[skillAgentId] === true) {
                if (skillAgentId === 'claude') {
                  const pluginDir = writeClaudeSkillsPlugin(skillsCfg.folder)
                  if (pluginDir !== null) tail.push('--plugin-dir', pluginDir)
                } else if (skillAgentId === 'hermes') {
                  tail.push('--skills', skillsCfg.folder)
                }
              }
            } catch {
              /* skills wiring is best-effort; never block the spawn */
            }
            // Non-Claude agents that read their MCP config from env/flags get the
            // project MCP + engagement briefing wired the same spirit as Claude's
            // flag tail: per launch, gated by the wiring toggle. opencode today.
            const mcpInjection = agentLaunchInjection(adapterName, 'interactive', id, cleanup.defer)
            const mcpSpawnEnv = mcpInjection?.env
            if (mcpInjection?.args !== undefined) tail.push(...mcpInjection.args)
            // Agents without a system-prompt flag get the briefing through the
            // context file they read from the launch directory (the engagement
            // root, this terminal's cwd). No-op for claude/opencode.
            writeAgentContext(adapterName, options.project.root)
            const wantResume = typeof resume === 'string' && resume !== ''
            // Fresh interactive launch: prime with the caller's prompt (if any) as
            // the interactive positional, so e.g. `claude "<prompt>"` opens the TUI
            // already primed with the task.
            const freshArgv = [...adapter.buildArgv({ prompt: prompt ?? '', headless: false }), ...tail]
            if (!wantResume) {
              const [command, ...args] = freshArgv
              spawn({
                command: command ?? process.execPath,
                args,
                cwd: options.project.root,
                ...(mcpSpawnEnv !== undefined ? { env: mcpSpawnEnv } : {}),
              })
              return { id }
            }
            // Resume the prior conversation by id. A stale/invalid id makes the CLI
            // exit non-zero, so on POSIX we OR into a fresh launch (`resume || exec
            // fresh`) in the same cwd — the pane always opens instead of dying. On
            // win32 we spawn the resume argv directly (no shell fallback).
            const resumeArgv = [...adapter.buildArgv({ prompt: '', headless: false, resume }), ...tail]
            if (process.platform === 'win32') {
              const [command, ...args] = resumeArgv
              spawn({
                command: command ?? process.execPath,
                args,
                cwd: options.project.root,
                ...(mcpSpawnEnv !== undefined ? { env: mcpSpawnEnv } : {}),
              })
              return { id }
            }
            const line = `${resumeArgv.map(shQuote).join(' ')} || exec ${freshArgv.map(shQuote).join(' ')}`
            spawn({
              command: '/bin/sh',
              args: ['-c', line],
              cwd: options.project.root,
              ...(mcpSpawnEnv !== undefined ? { env: mcpSpawnEnv } : {}),
            })
            return { id }
          } finally {
            if (!spawned) cleanup.run()
          }
        }
      : undefined)

  const api = new Hono()
  api.use('*', bearerAuth(options.token, { registry: agentTokens, routes: AGENT_API_ROUTES }))
  // on_create is fired by the repository wrap above (covers this route + tool
  // nodes), so the route no longer needs its own onCreated hook.
  api.route('/', targetRoutes(options.project))
  api.route('/', scopeRuleRoutes(options.project))
  api.route('/', projectRoutes(options.project))
  api.route('/', overviewRoutes(options.project))
  api.route('/', nodeRoutes(options.project, options.registry, options.executor))
  api.route('/', workflowRoutes(options.project))
  api.route('/', backendRoutes(options.project))
  api.route('/', customNodeRoutes(options.project, options.registry))
  api.route('/', secretRoutes(options.project))
  api.route('/', agentRoutes())
  api.route('/', agentModelsRoutes())
  api.route(
    '/',
    toolRoutes({
      manifests: () => [...buildManifestMap(options.registry, options.project).values()],
      backends: () => options.project.backends.list(),
    }),
  )
  api.route('/', filesRoutes(options.project))
  api.route('/', gitRoutes(options.project))
  api.route('/', sessionRoutes(options.project))
  api.route('/', teamRoutes())
  api.route('/', usageRoutes(options.project))
  api.route('/', skillRoutes(options.project))
  api.route('/', agentMcpRoutes())
  api.route('/', usageLimitsRoutes())
  api.route('/', findingRoutes(options.project))
  api.route('/', logsRoutes({ bus: options.bus }))
  api.route('/', scheduleRoutes(options.project, () => scheduler.start()))
  api.route('/', savedAgentRoutes(options.project, savedAgentsStore))
  api.route(
    '/',
    executionRoutes({
      project: options.project,
      bus: options.bus,
      registry: options.registry,
      runs,
      ...(agentRunner !== undefined ? { agentRunner } : {}),
      ...(enginePort !== undefined ? { enginePort } : {}),
    }),
  )
  if (createTerminal !== undefined) {
    api.route('/', terminalRoutes(createTerminal))
  }
  if (assistantRunner !== undefined) {
    api.route('/', assistantRoutes({ project: options.project, runner: assistantRunner }))
  }
  api.route('/', agentHookRoutes(options.bus, new TranscriptWatchers(options.bus)))

  // "Start with AI": parse a free-form scope into targets. When claude is the
  // chosen agent and we have a live pty + connection, run it headless with the
  // MCP toolset + lifecycle hooks (streamed under the runId); otherwise the run
  // falls back to the deterministic parser. Either way the deterministic
  // reconcile guarantees the targets land.
  const buildScopeRunAgent: RunAgentFactory | undefined =
    ptyRegistry !== undefined && connection !== undefined
      ? (agent, runId) => {
          if (agent !== 'claude') return undefined
          return ({ scope, description }) =>
            new Promise<void>((resolve) => {
              const cleanup = new LaunchCleanup()
              try {
                const { mcpConfig, settings } = claudeLaunchFiles(connection.port, 'scope', cleanup.defer, { id: runId, hooks: true })
                // Prompt right after -p; --allowedTools + --mcp-config are variadic,
                // so keep --mcp-config last (the proven order used elsewhere).
                const argv = [
                  'claude',
                  '-p',
                  buildScopePrompt(scope, description),
                  '--output-format',
                  'json',
                  '--allowedTools',
                  ...claudeAllowedTools('scope'),
                  '--settings',
                  settings,
                  '--mcp-config',
                  mcpConfig,
                ]
                const [command, ...args] = argv
                const session = ptyRegistry.create(newId(), {
                  command: command ?? 'claude',
                  args,
                  cwd: options.project.root,
                  unsetEnv: CLAUDE_SESSION_MARKERS,
                })
                session.onExit(() => {
                  cleanup.run()
                  resolve()
                })
              } catch {
                // A missing claude binary, or a launch file that could not be
                // written: revoke and clean up, then resolve so the run reports.
                cleanup.run()
                resolve()
              }
            })
        }
      : undefined
  api.route(
    '/',
    scopeRoutes({
      project: options.project,
      bus: options.bus,
      toolsetDeps,
      ...(buildScopeRunAgent !== undefined ? { buildRunAgent: buildScopeRunAgent } : {}),
    }),
  )
  app.route('/api', api)

  const toolset = new ProjectToolset(toolsetDeps)
  app.route('/', mcpRoute(toolset, options.token, agentTokens))

  const engineApp = app as EngineApp
  engineApp.scheduler = scheduler
  return engineApp
}
