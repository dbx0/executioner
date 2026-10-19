import { join } from 'node:path'

export const DOT_DIR = '.executioner'

export const layout = {
  dotDir: (root: string) => join(root, DOT_DIR),
  database: (root: string) => join(root, DOT_DIR, 'project.sqlite'),
  config: (root: string) => join(root, DOT_DIR, 'config.json'),
  workflows: (root: string) => join(root, 'workflows'),
  evidence: (root: string) => join(root, 'evidence'),
  executionEvidence: (root: string, executionId: string) =>
    join(root, 'evidence', executionId),
}
