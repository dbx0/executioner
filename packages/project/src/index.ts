import { existsSync, mkdirSync } from 'node:fs'
import {
  openDatabase,
  openGlobalDatabase,
  FactRepository,
  TargetRepository,
  ScopeRuleRepository,
  ExecutionRepository,
  RunRepository,
  OverviewRepository,
  WorkflowRepository,
  FindingRepository,
  BackendProfileRepository,
  SecretRepository,
  CustomNodeRepository,
  ScheduleRepository,
  SavedAgentRepository,
  AssistantRepository,
  adoptProjectGlobals,
  seedStarterWorkflows,
  type ProjectDatabase,
} from '@exe/db'
import { globalLayout, isoNow } from '@exe/protocol'
import { layout } from './layout.js'
import { projectConfigSchema, readConfig, writeConfig, type ProjectConfig } from './config.js'

export interface Project {
  root: string
  config: ProjectConfig
  db: ProjectDatabase
  /** The user-level database behind `workflows`, `customNodes`, `backends` and `secrets`. */
  globalDb: ProjectDatabase
  targets: TargetRepository
  /** The engagement's boundary. Every target write is judged against it. */
  scopeRules: ScopeRuleRepository
  facts: FactRepository
  executions: ExecutionRepository
  /** Workflow runs and the node rows a graph run writes as it walks. */
  runs: RunRepository
  /** The aggregate reads behind the engagement overview. */
  overview: OverviewRepository
  /** Saved workflows. USER-level: built once, available in every engagement. */
  workflows: WorkflowRepository
  findings: FindingRepository
  /** Connections. USER-level: the same profiles in every engagement. */
  backends: BackendProfileRepository
  /** API credentials. USER-level: the same keys in every engagement. */
  secrets: SecretRepository
  /** Custom nodes. USER-level, so a shared workflow can name them anywhere. */
  customNodes: CustomNodeRepository
  schedules: ScheduleRepository
  savedAgents: SavedAgentRepository
  assistant: AssistantRepository
  /** Creates the directory if needed and returns its absolute path. */
  evidenceDir(executionId: string): string
  close(): void
}

export function isProjectFolder(root: string): boolean {
  return existsSync(layout.database(root)) && existsSync(layout.config(root))
}

export function createProject(root: string, options: { name: string }): Project {
  if (isProjectFolder(root)) {
    throw new Error(`${root} is already an Executioner project`)
  }

  mkdirSync(layout.dotDir(root), { recursive: true })
  mkdirSync(layout.workflows(root), { recursive: true })
  mkdirSync(layout.evidence(root), { recursive: true })

  const config = projectConfigSchema.parse({
    name: options.name,
    defaultBackend: 'local',
    createdAt: isoNow(),
  })
  writeConfig(root, config)

  return attach(root, config)
}

export function openProject(root: string): Project {
  if (!isProjectFolder(root)) {
    throw new Error(`${root} is not an Executioner project`)
  }
  return attach(root, readConfig(root))
}

function attach(root: string, config: ProjectConfig): Project {
  const db = openDatabase(layout.database(root))
  // Workflows, their custom nodes, connections and secrets live in the
  // user-level database, not this engagement's: they are the same wherever you
  // work. An engagement created before that was true hands its rows over once.
  const globalDb = openGlobalDatabase(globalLayout.database())
  adoptProjectGlobals(db, globalDb)
  seedStarterWorkflows(globalDb)
  return {
    root,
    config,
    db,
    globalDb,
    targets: new TargetRepository(db),
    scopeRules: new ScopeRuleRepository(db),
    facts: new FactRepository(db),
    executions: new ExecutionRepository(db),
    runs: new RunRepository(db),
    overview: new OverviewRepository(db),
    workflows: new WorkflowRepository(globalDb),
    findings: new FindingRepository(db),
    backends: new BackendProfileRepository(globalDb),
    secrets: new SecretRepository(globalDb),
    customNodes: new CustomNodeRepository(globalDb),
    schedules: new ScheduleRepository(db),
    savedAgents: new SavedAgentRepository(db),
    assistant: new AssistantRepository(db),
    evidenceDir: (executionId: string) => {
      const path = layout.executionEvidence(root, executionId)
      mkdirSync(path, { recursive: true })
      return path
    },
    close: () => {
      db.close()
      globalDb.close()
    },
  }
}

export * from './layout.js'
export { ADOPTED_KEY, adoptProjectGlobals, type AdoptResult } from '@exe/db'
export * from './config.js'
export * from './scaffold.js'
export * from './program.js'
