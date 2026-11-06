import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pickWorkflowFile, MAX_WORKFLOW_BYTES } from './workflow-file.js'

const logger = () => ({ info: vi.fn(), error: vi.fn() })

describe('native workflow import', () => {
  it('reads the selected file without logging workflow contents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workflow-file-'))
    try {
      const path = join(dir, 'workflow.json')
      const text = '{"name":"private-workflow-content","graph":{"nodes":[],"edges":[]}}'
      await writeFile(path, text)
      const log = logger()
      expect(await pickWorkflowFile(async () => path, log)).toEqual({ name: 'workflow.json', text })
      expect(log.info).toHaveBeenCalledWith('main/workflows', 'Workflow file read', { filename: 'workflow.json', bytes: Buffer.byteLength(text) })
      expect(JSON.stringify(log.info.mock.calls)).not.toContain('private-workflow-content')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('records cancellation', async () => {
    const log = logger()
    expect(await pickWorkflowFile(async () => undefined, log)).toBeUndefined()
    expect(log.info).toHaveBeenCalledWith('main/workflows', 'Workflow import cancelled')
  })

  it('records and propagates picker errors', async () => {
    const log = logger()
    await expect(pickWorkflowFile(async () => { throw new Error('picker failed') }, log)).rejects.toThrow('picker failed')
    expect(log.error).toHaveBeenCalled()
  })

  it('rejects oversized files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workflow-file-'))
    try {
      const path = join(dir, 'big.json')
      await writeFile(path, Buffer.alloc(MAX_WORKFLOW_BYTES + 1))
      await expect(pickWorkflowFile(async () => path, logger())).rejects.toThrow('10 MiB')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
