import { Hono } from 'hono'
import { z } from 'zod'
import type { Project } from '@exe/project'
import type { AssistantRunInput, AssistantRunResult } from '../agents/assistant-runner.js'

/** Minimal runner surface so the route can be tested with a mock. */
export interface AssistantRunnerLike {
  run(input: AssistantRunInput): Promise<AssistantRunResult>
}

export interface AssistantRouteDeps {
  project: Project
  runner: AssistantRunnerLike
}

const messageBody = z.object({
  text: z.string().min(1),
  graph: z.unknown(),
  agent: z.string().min(1).optional(),
})
const patchBody = z.object({ agent: z.string().min(1) })

/**
 * The one-line-per-node graph shape the assistant must produce. Kept compact so
 * the first-turn prompt stays small; the agent gets the full param catalog by
 * calling list_node_types.
 */
const GRAPH_SPEC = [
  'A workflow graph is JSON: { "nodes": [...], "edges": [...] }.',
  'Each node: { "id": "<unique string>", "type": "<node type>", "data": { <params keyed by param name> } }.',
  'Each edge: { "id": "<unique>", "source": "<node id>", "target": "<node id>", "sourceHandle": <null | "true" | "false"> }.',
  'Every workflow starts with a trigger node (usually "manual"). Use "true"/"false" sourceHandle only on edges leaving an "if" node.',
].join('\n')

/**
 * How to pick a node type. The single biggest failure is defaulting to an `agent`
 * node for work a real tool or a script does deterministically. Steer hard toward
 * the built-in tool nodes and `python_script`; reserve `agent` for genuine LLM
 * judgement only.
 */
const NODE_CHOICE = [
  'NODE CHOICE — build workflows from the real nodes, not from agents:',
  '- Prefer a dedicated TOOL node whenever one exists for the job (subfinder, httpx, nmap, whois, katana, gau, nuclei, wafw00f, whatweb, screenshot, ffuf, etc.). list_node_types is the source of truth for what exists — check it before inventing an approach.',
  '- For custom deterministic processing (regex-scan JS for secrets, parse a tool’s output, filter/transform/dedupe, call an HTTP endpoint), use a `python_script` node. It receives upstream rows and emits structured rows.',
  '- Do NOT use an `agent` node for recon, scanning, parsing, or any task a tool node or a python_script can do. Reserve `agent` nodes ONLY for open-ended work that genuinely needs an LLM’s reasoning (e.g. triaging findings into a written summary) — never as the default building block.',
  '- A good recon workflow is mostly tool nodes fanning out from the trigger, with python_script nodes for the custom analysis steps.',
].join('\n')

/**
 * How `{{ }}` templates resolve in a node's param values. Node params are plain
 * strings; wrap a template in `{{ }}` to interpolate a value at run time. The
 * assistant needs this to wire one node's output into the next node's params.
 */
const TEMPLATING = [
  'TEMPLATING: any node param value may contain `{{ }}` placeholders resolved at run time. Namespaces:',
  '- {{ target.value }} / {{ target.kind }} — the target the workflow runs against.',
  '- {{ nodes.<nodeId>.<field> }} — a field from an UPSTREAM node’s output row (the fields each node exposes are listed as its "outputs" in list_node_types). {{ nodes.<nodeId>.output }} is that node’s raw text output.',
  '- {{ vars.<name> }} — a run variable set by a set_variable node.',
  '- {{ secrets.<name> }} — a stored secret (e.g. {{ secrets.SHODAN_API_KEY }}).',
  '- {{ loop.item }} — the current item inside a loop node’s body.',
  '- {{ params.<name> }} — another param on the same node.',
  'Only use a template where a value must come from elsewhere; plain static values need no braces. To feed one node’s result into another, connect them with an edge and reference {{ nodes.<upstreamId>.<field> }} (use that node’s listed outputs).',
].join('\n')

/**
 * Saving rules the assistant must follow — the recon/scan tool nodes already
 * persist their PARSED results to the target on their own (nmap saves open
 * ports, subfinder saves discovered subdomains as child targets, whois saves a
 * structured record). So the assistant should NOT add a `save_to_target` node
 * after them — that only creates duplicates. `save_to_target` is for custom or
 * derived data a tool node does not itself emit.
 */
const SAVE_RULES = [
  'SAVING: recon/scan tool nodes auto-save their parsed output to the target — nmap saves open ports, subfinder saves subdomains as child targets, whois saves a structured record. Do NOT add a save_to_target node after these; it duplicates data. Use save_to_target only for custom/derived data a tool does not already emit, and never to re-save a tool node’s own output.',
  'To run a tool WITHOUT persisting its output, set its "__no_save": true — the tool still runs and feeds downstream nodes.',
  'Subdomain enumeration (subfinder) can take a while; do not give it a tiny timeout.',
].join('\n')

function buildContextPrompt(text: string): string {
  return [
    'You are the AI workflow assistant inside a security-automation workflow editor.',
    'You help the user CREATE or EDIT the workflow open on their canvas.',
    '',
    'Work through your MCP tools:',
    '- Call list_node_types to see every usable node type and its params/settings.',
    '- Call get_workflow_graph to read the CURRENT canvas graph and edit from it.',
    '- To debug a run, call list_executions then get_execution (per-node status, exit codes, stdout/stderr) — omit the id for the last run — then explain what went wrong and, if asked, propose a fix.',
    '- When you have the new graph, call propose_workflow with the FULL new graph and a one-line summary.',
    '  It is validated; if it returns { ok:false, errors }, fix the graph and call it again.',
    '  Never describe a graph without calling propose_workflow — the user applies your proposal to the canvas.',
    '',
    GRAPH_SPEC,
    '',
    NODE_CHOICE,
    '',
    TEMPLATING,
    '',
    SAVE_RULES,
    '',
    'Keep your text reply short: say what you built or changed. The proposal carries the graph.',
    '',
    `User request: ${text}`,
  ].join('\n')
}

function buildFollowupPrompt(text: string): string {
  return [
    'Continue editing the workflow. Call get_workflow_graph for the latest canvas state if needed,',
    'then call propose_workflow with the FULL updated graph and a one-line summary.',
    'Build from real tool nodes + python_script; do not use `agent` nodes for work a tool or script can do.',
    '',
    `User request: ${text}`,
  ].join('\n')
}

export function assistantRoutes(deps: AssistantRouteDeps): Hono {
  const { project, runner } = deps
  const app = new Hono()

  app.get('/assistant/conversation', (c) => {
    const workflowId = c.req.query('workflowId')
    if (workflowId === undefined || workflowId === '') return c.json({ error: 'workflowId required' }, 400)
    const agent = c.req.query('agent') ?? 'claude'
    const conversation = project.assistant.getOrCreateForWorkflow(workflowId, agent)
    return c.json({ conversation, messages: project.assistant.listMessages(conversation.id) })
  })

  app.post('/assistant/conversation/:id/message', async (c) => {
    const conversation = project.assistant.get(c.req.param('id'))
    if (conversation === undefined) return c.json({ error: 'not found' }, 404)

    const parsed = messageBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request', detail: parsed.error.format() }, 400)

    // Switching agent mid-thread invalidates the prior CLI session id.
    let agent = conversation.agent
    let sessionId = conversation.sessionId
    if (parsed.data.agent !== undefined && parsed.data.agent !== conversation.agent) {
      agent = parsed.data.agent
      sessionId = null
      project.assistant.setAgent(conversation.id, agent)
    }

    // Persist the user message first so it survives an agent failure.
    project.assistant.addMessage({ conversationId: conversation.id, role: 'user', content: parsed.data.text })

    const isFirstTurn = sessionId === null || sessionId === ''
    const prompt = isFirstTurn ? buildContextPrompt(parsed.data.text) : buildFollowupPrompt(parsed.data.text)

    // The runner binds the live graph to this turn's session only, so
    // get_workflow_graph from any other agent session never sees it.
    const result: AssistantRunResult = await runner.run({
      prompt,
      agent,
      graph: parsed.data.graph,
      ...(isFirstTurn ? {} : { sessionId: sessionId as string }),
    })

    const message = project.assistant.addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: result.reply,
      ...(result.proposal === undefined ? {} : { proposal: result.proposal }),
    })
    if (result.sessionId !== undefined && result.sessionId !== '') {
      project.assistant.setSession(conversation.id, result.sessionId)
    }

    return c.json({ message })
  })

  app.patch('/assistant/conversation/:id', async (c) => {
    const conversation = project.assistant.get(c.req.param('id'))
    if (conversation === undefined) return c.json({ error: 'not found' }, 404)
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'invalid request' }, 400)
    project.assistant.setAgent(conversation.id, parsed.data.agent)
    const updated = project.assistant.get(conversation.id)
    return c.json({ conversation: updated })
  })

  return app
}
