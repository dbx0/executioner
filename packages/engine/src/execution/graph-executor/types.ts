import type { Graph } from '@exe/graph'
import type { Project } from '@exe/project'
import type { BackendProfile, ToolManifest } from '@exe/protocol'
import type { AgentRunner } from '../../agents/agent-runner.js'
import type { EventBus } from '../../transport/events.js'
import type { CancellationRegistry } from '../cancellation.js'
import type { RunRepository } from '@exe/db'
import type { Sender } from './builtin/http-client.js'
import type { Resolver } from './builtin/http-guard.js'

export const EXECUTION_CHANNEL = '__execution__'

export interface GraphExecutorDeps {
  project: Project
  bus: EventBus
  manifests: Map<string, ToolManifest>
  store: RunRepository
  agentRunner?: AgentRunner
  /** Lets a run be stopped from outside. Absent → the run cannot be cancelled. */
  runs?: CancellationRegistry
  /** The port the engine's API listens on, read lazily: http_request and notify never call it. */
  enginePort?: () => number
  /** How http_request and notify resolve hostnames. Absent → the system resolver. */
  resolveHost?: Resolver
  /** How http_request and notify put one vetted hop on the wire. Absent → node:http(s). Injected in tests. */
  sendHttp?: Sender
}

export interface GraphRunInput {
  graph: Graph
  workflowId: string | null
  targetId: string | null
  testMode: boolean
  /** Where node commands run. Absent / local profile → local execution. */
  backendProfile?: BackendProfile
  /** Awaited before each executing node (gate for step-through runs). */
  beforeNode?: (nodeId: string) => Promise<void>
  /** Called once, right after the execution row is created, with its id. */
  onExecutionCreated?: (executionId: string) => void
}

export interface GraphRunResult {
  executionId: string
  status: 'succeeded' | 'failed' | 'cancelled'
}
