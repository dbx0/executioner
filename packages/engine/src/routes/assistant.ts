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
  'Every workflow begins with exactly one "manual" node, the Start node, wired to the first nodes. It has no settings. Do not try to express when the workflow runs inside the graph: a schedule, or running when a target is added, is an action the user sets up on the Actions page. Say so in your reply if they asked for one.',
  'Use "true"/"false" sourceHandle only on edges leaving an "if" node.',
].join('\n')

/**
 * How to pick a node type. Two failures are steered against here. The older one
 * is reaching for an `agent` node for work a tool does deterministically. The
 * one that produced the worst graphs is reaching for `python_script`: a script
 * is opaque on the canvas, the operator cannot tune it from the node's own
 * settings, it saves nothing unless more nodes are bolted on after it, and it
 * tends to hardcode one programme's hosts and limits into a workflow meant to be
 * reused. Almost every script the assistant used to write (build a list for a
 * loop, check a host is alive, re-emit a row after an IF, save a value) is
 * something a node or a node setting already does, so those are named outright.
 */
const NODE_CHOICE = [
  'NODE CHOICE: a workflow is a graph of nodes that each do one job and already know how to save what they find. Build it from the nodes that exist. list_node_types is the source of truth: read it before deciding on an approach, including the description and outputs of each node.',
  '- Use a dedicated node whenever one covers the job. Typical recon needs and the node for each: subdomains = subfinder or amass; is it alive, page title, certificate = httpx; technologies = whatweb; WAF = wafw00f; ports and services = nmap or naabu; crawl URLs = katana or gau; known exposures and vulnerabilities = nuclei; DNS records and reverse DNS = dns_records or dnsx; certificate only = tls_cert; IP ranges of a network = asn; cloud storage = cloud_buckets; a picture of the page = screenshot (it takes request headers); a plain HTTP call = http_request.',
  '- Wire nodes together with their settings (see NODE SETTINGS and LOOPS below) instead of writing glue code. You do not need a script to turn a tool’s results into a loop, to test whether a host answered, to carry a row past an IF, to save a result, or to add a header to a screenshot: each of those is a node or a setting.',
  '- python_script is the last resort: use it only when no node and no combination of nodes can do the job, and then say in your reply what the script does and why a node could not. A script is opaque on the canvas, the operator cannot adjust it from the node’s settings, and it does not save its results the way a node does.',
  '- Never hardcode one programme’s details into a node or a script: no lists of in-scope ranges or excluded hosts, no host caps chosen for one target. Scope lives in the engagement’s scope rules and every saved asset is judged against them automatically; the workflow should stay reusable on the next target. A request header or rate limit the user asks for goes in the param of the node that has one.',
  '- An `agent` node is only for open-ended work that needs an LLM’s judgement, such as writing a triage summary. Never use one for recon, scanning or parsing.',
].join('\n')

/**
 * The settings every node carries besides its own params, and how a loop walks
 * another node’s results. These are what make glue scripts unnecessary, and
 * list_node_types does not show them per node, so they are spelled out.
 */
const NODE_SETTINGS = [
  'NODE SETTINGS: besides its own params, every tool and recon node accepts these keys in "data":',
  '- "target": what this node runs against. Leave it out to use the workflow’s target. Set it to a template to aim the node elsewhere, most often {{ loop.item.<field> }} inside a loop. The node’s results are saved on that host, not on the workflow’s target.',
  '- "__no_save": true runs the node for its output only, saving nothing; downstream nodes still get its rows. This is the "Save results to target" switch in the editor. Leave it out when the results should be kept, which is the usual case.',
  '- "__on_failure": "stop" halts the run if this node fails; the default "continue" carries on.',
  '- "__timeout_ms": a number, when the node needs longer than its default (subdomain enumeration and crawls often do).',
  '',
  'LOOPS: a `loop` node runs every node downstream of it once per item.',
  '- Set its "source" to {{ nodes.<nodeId>.rows }} to walk the parsed result rows of an upstream node. Inside the body, {{ loop.item.<field> }} reads a field of the current row; the fields are that node’s listed outputs (for subfinder, {{ loop.item.host }}).',
  '- "max_items" caps how many items the body runs for; leave it out to walk them all.',
  '- An `if` inside the body gates the rest of that one iteration. It tests the row of the node just before it, read as `data`, and passes that row on to the nodes after it. A node that found nothing has no row, so `data.status_code > 0` after an httpx node is false for a dead host.',
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
  '- {{ loop.item }} — the current item inside a loop node’s body; {{ loop.item.<field> }} when the loop walks rows.',
  '- {{ nodes.<nodeId>.rows }} — only as a loop node’s "source": every parsed row of that node.',
  '- {{ params.<name> }} — another param on the same node.',
  'Only use a template where a value must come from elsewhere; plain static values need no braces. To feed one node’s result into another, connect them with an edge and reference {{ nodes.<upstreamId>.<field> }} (use that node’s listed outputs).',
].join('\n')

/**
 * Saving rules. Every tool and recon node persists its own parsed results, so a
 * `save_to_target` after one only writes the same data twice, and a script that
 * prints a value for a `save_to_target` to pick up is two nodes doing what the
 * first node’s own switch does.
 */
const SAVE_RULES = [
  'SAVING: every tool and recon node saves its own parsed results to the target it ran against (nmap its open ports, subfinder its subdomains as child targets, httpx the HTTP service and certificate, whatweb the technologies, screenshot the image, and so on). That is on by default and is controlled per node by "__no_save".',
  '- Do not add a save_to_target node after a node that already saves: it duplicates the data. Do not route a node through a script and a save_to_target to save what the node would have saved itself.',
  '- save_to_target is only for a value that no node emitted, which is rare. If you think you need one, check the outputs of the node first.',
  '- To turn result rows into findings, use save_to_finding and template its title, severity and details from {{ row.<field> }}.',
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
    NODE_SETTINGS,
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
    'Build from the nodes that exist and their own settings (target, __no_save, loops over {{ nodes.<nodeId>.rows }}). A python_script is the last resort, an `agent` node is only for LLM judgement, and a node that already saves needs no save_to_target after it.',
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
