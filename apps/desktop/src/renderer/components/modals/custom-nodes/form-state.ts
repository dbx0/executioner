import axios from 'axios'
import type { CustomNode, CustomNodeInput, EmitSpec } from '../../../api/custom-nodes.js'
import type { EngineParamSpec } from '../../../api/nodes.js'

export type Parser = EmitSpec['parser']

export interface FormState {
  editingId?: string
  id: string
  name: string
  description: string
  category: string
  accepts: string
  program: string
  args: string
  timeout: string
  params: string
  parser: Parser
  source: 'stdout' | 'stderr'
  records: string
  pattern: string
  path: string
  format: 'json' | 'jsonl'
}

export const empty: FormState = {
  id: '',
  name: '',
  description: '',
  category: 'custom',
  accepts: 'domain',
  program: '',
  args: '',
  timeout: '',
  params: '',
  parser: 'json',
  source: 'stdout',
  records: '$',
  pattern: '',
  path: '',
  format: 'json',
}

export function toForm(n: CustomNode): FormState {
  return {
    editingId: n.id,
    id: n.id,
    name: n.name,
    description: n.description,
    category: n.category,
    accepts: n.accepts.join(', '),
    program: n.command.program,
    args: n.command.args.join('\n'),
    timeout: String(n.command.timeout_ms),
    params: Object.keys(n.params).length === 0 ? '' : JSON.stringify(n.params, null, 2),
    parser: n.emit.parser,
    source: n.emit.source ?? 'stdout',
    records: n.emit.records ?? '$',
    pattern: n.emit.pattern ?? '',
    path: n.emit.path ?? '',
    format: n.emit.format ?? 'json',
  }
}

/** Turn the form into the API payload, or throw a readable error for bad JSON. */
export function toInput(f: FormState): CustomNodeInput {
  const accepts = f.accepts
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  const args = f.args.split('\n').map((s) => s.trim()).filter((s) => s !== '')

  let params: Record<string, EngineParamSpec> | undefined
  if (f.params.trim() !== '') {
    let parsed: unknown
    try {
      parsed = JSON.parse(f.params)
    } catch {
      throw new Error('Params must be valid JSON (a map of name → param spec).')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Params must be a JSON object keyed by param name.')
    }
    params = parsed as Record<string, EngineParamSpec>
  }

  const emit: EmitSpec = { parser: f.parser, source: f.source, records: f.records.trim() || '$' }
  if (f.parser === 'regex') emit.pattern = f.pattern
  if (f.parser === 'file') {
    emit.path = f.path
    emit.format = f.format
  }

  const command: CustomNodeInput['command'] = { program: f.program.trim(), args }
  if (f.timeout.trim() !== '' && Number.isFinite(Number(f.timeout))) command.timeout_ms = Number(f.timeout)

  const input: CustomNodeInput = {
    id: f.id.trim(),
    name: f.name.trim(),
    description: f.description.trim(),
    category: f.category.trim() || 'custom',
    accepts,
    command,
    emit,
  }
  if (params !== undefined) input.params = params
  return input
}

/** Pull a clean message off a validation error response. */
export function apiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string } | undefined
    if (data?.error !== undefined) return data.error
  }
  return (e as Error).message
}
