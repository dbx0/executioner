export interface ToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const str = { type: 'string' }

const dialogProps = {
  dialog: { type: 'string', enum: ['accept', 'dismiss'], description: "How to answer a dialog this action opens. Dialogs are dismissed unless this is 'accept'." },
  promptText: { type: 'string', description: "Text to enter when accepting a prompt() dialog." },
}
const refProp = { type: 'string', description: 'An element ref from the latest browser_snapshot. Refs go stale after the page changes.' }
const shared =
  ' The browser is shared with the operator and visible to them.'

const BROWSER_SCHEMAS: ToolSchema[] = [
  {
    name: 'browser_open',
    description: 'Open the embedded browser for this session, optionally at a url, and report whether the url is in scope.' + shared,
    inputSchema: { type: 'object', properties: { url: str } },
  },
  {
    name: 'browser_navigate',
    description: 'Go to a url. The result carries scopeStatus (in/out/unknown); out of scope pages are reported, not blocked, so check it.' + shared,
    inputSchema: { type: 'object', properties: { url: str, ...dialogProps }, required: ['url'] },
  },
  {
    name: 'browser_snapshot',
    description:
      'Return the page as text with a ref for each interactive element. Use these refs for click, type and select; they go stale after the page changes, so take a new snapshot. Each iframe gets its own section headed [frame=f<n>]; pass that f<n> as frame to browser_eval to run JavaScript inside that iframe, whatever its origin.' + shared,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Click the element with the given ref from browser_snapshot.' + shared,
    inputSchema: { type: 'object', properties: { ref: refProp, ...dialogProps }, required: ['ref'] },
  },
  {
    name: 'browser_type',
    description: 'Type text into the element with the given ref, optionally clearing it first and pressing Enter after.' + shared,
    inputSchema: {
      type: 'object',
      properties: { ref: refProp, text: str, clear: { type: 'boolean' }, submit: { type: 'boolean' }, ...dialogProps },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'browser_press',
    description: 'Press a key such as Enter, Tab or Escape on the page.' + shared,
    inputSchema: { type: 'object', properties: { key: str, ...dialogProps }, required: ['key'] },
  },
  {
    name: 'browser_select',
    description: 'Choose option values in the select element with the given ref.' + shared,
    inputSchema: {
      type: 'object',
      properties: { ref: refProp, values: { type: 'array', items: str } },
      required: ['ref', 'values'],
    },
  },
  {
    name: 'browser_eval',
    description:
      "Evaluate a JavaScript expression in the page and return its value. Without frame it runs in the top document only. To run inside an iframe (including a cross-origin one), take a browser_snapshot and pass the frame label shown as [frame=f<n>] as frame; the expression then runs in that frame's own document and sees its globals. Labels go stale after the top page navigates." + shared,
    inputSchema: {
      type: 'object',
      properties: {
        expression: str,
        frame: { type: 'string', description: 'An iframe label such as f1 from the [frame=f<n>] headers of the latest browser_snapshot.' },
        ...dialogProps,
      },
      required: ['expression'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for a css selector to appear or for a navigation, up to timeoutMs (default 5000, at most 30000). matched says whether it happened.' + shared,
    inputSchema: {
      type: 'object',
      properties: { selector: str, navigation: { type: 'boolean' }, timeoutMs: { type: 'number' } },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a png screenshot of the page. It is saved under the engagement evidence folder and its path is returned along with the image.' + shared,
    inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' } } },
  },
  {
    name: 'browser_log',
    description:
      'Return console messages and dialogs seen since the cursor, including those the operator triggered, which is how an XSS alert becomes evidence. Pass the returned next as since to read on.' + shared,
    inputSchema: { type: 'object', properties: { since: { type: 'number' } } },
  },
  {
    name: 'browser_network',
    description:
      'List the requests made by the page and its frames since the cursor, newest last. Each entry has a requestId for browser_response_body. Filter with urlContains; limit defaults to 100 and is at most 500. Pass the returned next as since to read on. requestHeaders are the headers as the page issued them, before any rewrite rule and before the network stack adds its own. sentHeaders are what actually went out on the wire, after rewrite rules and including headers the browser adds such as Cookie, Accept-Language and Accept-Encoding; trust sentHeaders for what the server received. receivedHeaders are the raw response headers including Set-Cookie. When a rule acted, rewrittenBy names it and rewrittenHeaders holds the headers it produced. sentHeaders and receivedHeaders are missing for requests that never reached the network, such as cached or fulfilled ones.' + shared,
    inputSchema: {
      type: 'object',
      properties: { since: { type: 'number' }, urlContains: str, limit: { type: 'number' } },
    },
  },
  {
    name: 'browser_response_body',
    description:
      'Return the response body of a request listed by browser_network, one window at a time. maxBytes (default 20000, at most 1000000) caps the decoded bytes returned and offset (default 0) is where the window starts. The result has totalBytes, offset, and truncated; when truncated is true, call again with offset set to the returned nextOffset to read on. Text is cut on a character boundary; binary bodies come back base64Encoded.' + shared,
    inputSchema: {
      type: 'object',
      properties: { requestId: str, offset: { type: 'number' }, maxBytes: { type: 'number' } },
      required: ['requestId'],
    },
  },
  {
    name: 'browser_rewrite_rules',
    description:
      "Replace the whole set of rewrite rules; [] turns rewriting off. The rules apply to every request from this browser until replaced. A rule matches urlPattern (a glob with * and ?), optionally a method, at stage 'request' (default) or 'response'. It can set or remove (null) headers, replace the body, or set the status; a request stage rule with a status answers without a network call. Headers the network stack adds itself (such as Cookie, Accept-Language and Accept-Encoding) may not be removable or replaceable by a rule; check sentHeaders in browser_network for what really went out." + shared,
    inputSchema: {
      type: 'object',
      properties: {
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: str,
              urlPattern: str,
              stage: { type: 'string', enum: ['request', 'response'] },
              method: str,
              setHeaders: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
              body: str,
              status: { type: 'number' },
            },
            required: ['urlPattern'],
          },
        },
      },
      required: ['rules'],
    },
  },
  {
    name: 'browser_upload',
    description: 'Set files on the file input with the given ref. Relative paths are resolved against the engagement root.' + shared,
    inputSchema: {
      type: 'object',
      properties: { ref: refProp, paths: { type: 'array', items: str } },
      required: ['ref', 'paths'],
    },
  },
  {
    name: 'browser_mouse',
    description:
      'Move, click, double click, press or release a mouse button, or scroll the wheel at a point. Coordinates are CSS pixels of the viewport, matching browser_screenshot. Use deltaX and deltaY for wheel.' + shared,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['move', 'click', 'double', 'down', 'up', 'wheel'] },
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        deltaX: { type: 'number' },
        deltaY: { type: 'number' },
      },
      required: ['action', 'x', 'y'],
    },
  },
  {
    name: 'browser_drag',
    description:
      'Drag from one element or point to another. Each end is a snapshot ref or an {x, y} point; points are CSS pixels of the viewport, matching browser_screenshot. steps (default 10, at most 200) is how many moves the drag is split into.' + shared,
    inputSchema: {
      type: 'object',
      properties: {
        from: { oneOf: [str, { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }] },
        to: { oneOf: [str, { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] }] },
        steps: { type: 'number' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'browser_emulate',
    description:
      'Override the user agent, geolocation, locale or timezone of this browser. null clears an override, an omitted field is left as it is. Returns the emulation now in effect. Client hints (Sec-CH-UA headers and navigator.userAgentData) are derived from userAgent: platform, mobile, architecture and Chrome brands from its Chrome/x token. Pass userAgentMetadata to set them exactly instead. Clearing userAgent goes back to a plain Chrome user agent with matching hints, and also clears userAgentMetadata unless the same call sets it.' + shared,
    inputSchema: {
      type: 'object',
      properties: {
        userAgent: { type: ['string', 'null'] },
        userAgentMetadata: {
          type: ['object', 'null'],
          description: 'Client hint metadata in the CDP Emulation.UserAgentMetadata shape; replaces what is derived from userAgent.',
          properties: {
            brands: { type: 'array', items: { type: 'object', properties: { brand: str, version: str }, required: ['brand', 'version'] } },
            fullVersionList: { type: 'array', items: { type: 'object', properties: { brand: str, version: str }, required: ['brand', 'version'] } },
            fullVersion: str,
            platform: str,
            platformVersion: str,
            architecture: str,
            model: str,
            mobile: { type: 'boolean' },
            bitness: str,
            wow64: { type: 'boolean' },
          },
          required: ['platform', 'platformVersion', 'architecture', 'model', 'mobile'],
        },
        geolocation: {
          type: ['object', 'null'],
          properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, accuracy: { type: 'number' } },
          required: ['latitude', 'longitude'],
        },
        locale: { type: ['string', 'null'] },
        timezone: { type: ['string', 'null'] },
      },
    },
  },
  {
    name: 'browser_ask_operator',
    description:
      'Ask the operator to do something only they can do in your browser, such as a CAPTCHA, an MFA, SMS or email code, or a login step, and wait for them. Never try to solve a CAPTCHA yourself. The operator sees message on the page and presses Done when finished, optionally with a reply (for example the MFA code to type). The call waits up to timeoutSec (default 45, at most 50) and returns {answered:true, reply?} when they are done. If they are not done yet it returns {answered:false, pending:true, reason:"timeout"}: the ask stays up, so call again with the same message to keep waiting. A repeated call joins the same ask without notifying the operator again, and if they finished between calls it returns their answer straight away. {answered:false, reason:"closed"} means the browser went away.' + shared,
    inputSchema: {
      type: 'object',
      properties: { message: str, timeoutSec: { type: 'number' } },
      required: ['message'],
    },
  },
]

/** JSON-schema tool definitions returned by tools/list. */
export const TOOL_SCHEMAS: ToolSchema[] = [
  { name: 'list_targets', description: 'List all targets in the project.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_target', description: 'Get one target with its facts and findings.', inputSchema: { type: 'object', properties: { value: str }, required: ['value'] } },
  {
    name: 'upsert_target',
    description:
      'Add or update a target (domain, subdomain, ip, cidr, url). kind is a hint only — the value decides, so an apex handed in as a subdomain is filed as a domain, and a host is parented under its registrable domain automatically. Never pass a wildcard such as *.example.com: that is a scope rule, and this call rejects it. The result carries scopeStatus (in/out/unknown) and scopeReason: when it comes back "unknown" the asset is outside everything the program listed, so stop and check before you test it.',
    inputSchema: { type: 'object', properties: { kind: str, value: str, parent: str }, required: ['kind', 'value'] },
  },
  {
    name: 'add_scope_rule',
    description:
      "Record one line of the engagement's boundary — WHERE testing may happen. effect is 'include' or 'exclude'. pattern must name an asset a tool could aim at: a host (example.com), a wildcard (*.example.com, which covers the apex too), a network (10.0.0.0/8), or a glob with a path (*/admin/*). note is why, and is shown to whoever reads the verdict later. An exclude always beats an include, so record every 'do not test' asset the program names. Adding a rule re-judges every target already in the tree. This is NOT for policy: a kind of bug that earns no bounty (denial of service, duplicates, version disclosure, unpatched CVEs) names no asset, and a pattern invented to carry it — class:..., device:..., asset:... — is rejected. Nor is it for non-network assets such as an App Store id or an Android package; report those in your summary instead.",
    inputSchema: {
      type: 'object',
      properties: { effect: str, pattern: str, note: str },
      required: ['effect', 'pattern'],
    },
  },
  {
    name: 'set_program_description',
    description:
      "Record the engagement's program brief: what this program is and the rules that govern testing it. Replaces the '## Program' section of HUNT.md and leaves the rest of the file alone. markdown is Markdown — a short paragraph, then bullets for rules of engagement, focus areas and limits. This is for REFORMATTING what the operator wrote: keep every fact, URL, limit and payout word for word, and never invent one. Scope patterns belong in add_scope_rule, not here.",
    inputSchema: { type: 'object', properties: { markdown: str }, required: ['markdown'] },
  },
  {
    name: 'list_scope_rules',
    description: "List the engagement's scope rules. Check here before adding an asset you are unsure about.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_finding',
    description:
      'Record a finding in the engagement. severity is one of critical/high/medium/low/info. description is the short what-and-why; details holds the evidence (request, payload, matched secret). target is the asset value it was found on, and may be omitted when none applies. Reporting the same title against the same target again refreshes that finding rather than duplicating it. Write description and details as Markdown — headings, lists, tables, **bold**, and a fenced code block around every command, request, response or payload — because both are stored and exported as Markdown, never as plain text.',
    inputSchema: {
      type: 'object',
      properties: { target: str, severity: str, title: str, description: str, details: str },
      required: ['severity', 'title'],
    },
  },
  {
    name: 'update_finding',
    description:
      'Update a finding by id — re-severity it, correct its text, or set status to open/confirmed/false_positive/discarded/fixed after triage. Use discarded for a real finding you are setting aside (out of scope, won\'t-fix, duplicate) and false_positive for one that is not a real issue. Always set status through this field — never encode triage state in the title (no "[discarded]"-style tags). description and details are Markdown; keep them so when you rewrite them.',
    inputSchema: {
      type: 'object',
      properties: { id: str, title: str, severity: str, status: str, description: str, details: str },
      required: ['id'],
    },
  },
  {
    name: 'list_findings',
    description: 'List the engagement findings, worst severity first. Optionally filter by status or severity.',
    inputSchema: { type: 'object', properties: { status: str, severity: str } },
  },
  { name: 'list_workflows', description: 'List saved workflows.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_executions',
    description: 'List recent workflow executions (newest first) with their status. Use to find the last run.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'get_execution',
    description:
      'Inspect one execution to diagnose what happened. Omit executionId for the most recent run. Returns each node with its status, exit code, and stdout/stderr tail.',
    inputSchema: { type: 'object', properties: { executionId: str } },
  },
  {
    name: 'run_workflow',
    description:
      'Run a saved workflow against a target. Omit backend (or pass "local") to run on this machine; pass a saved backend profile id to run the workflow nodes on that backend (SSH/Docker). Omitting it uses the engagement default backend when one is set. An unknown backend id is an error.',
    inputSchema: {
      type: 'object',
      properties: { workflowId: str, targetId: str, backend: str },
      required: ['workflowId', 'targetId'],
    },
  },
  {
    name: 'list_backends',
    description:
      'List the execution backends this engagement can run commands on: the local machine plus every saved SSH/Docker profile. Call this before run_command when you need tooling that is installed on a remote host rather than locally. Credentials are never returned.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command and get back its stdout, stderr and exit code. Omit backend (or pass "local") to run on this machine; pass a saved backend profile id to run the command on that backend (SSH/Docker/local). Has a hard timeout so it never hangs.',
    inputSchema: { type: 'object', properties: { command: str, backend: str }, required: ['command'] },
  },
  { name: 'set_node_output', description: 'Return structured data as this agent node output for downstream steps.', inputSchema: { type: 'object', properties: { data: { type: 'object' } }, required: ['data'] } },
  {
    name: 'list_node_types',
    description:
      'List every usable workflow node type with its params/settings (built-in graph nodes plus engine tool nodes). Call this before proposing a workflow so you use real node types and param names.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_workflow_graph',
    description:
      'Return the current canvas graph ({nodes, edges}) for the workflow being edited, so you can modify it rather than rebuild from scratch.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'propose_workflow',
    description:
      'Propose the FULL new workflow graph plus a one-line summary. The graph is validated; on failure the errors are returned so you can fix and retry. This never writes anything — the user reviews and applies the proposal.',
    inputSchema: {
      type: 'object',
      properties: {
        name: str,
        graph: {
          type: 'object',
          description: 'Full graph: { nodes: [{ id, type, data }], edges: [{ id, source, target, sourceHandle? }] }.',
          properties: {
            nodes: { type: 'array', items: { type: 'object' } },
            edges: { type: 'array', items: { type: 'object' } },
          },
          required: ['nodes', 'edges'],
        },
        summary: str,
      },
      required: ['graph', 'summary'],
    },
  },
  ...BROWSER_SCHEMAS,
]
