import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { MainLogger } from './logging/logger.js'

export const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024

/** Only reads the file selected by the operator; no arbitrary renderer path. */
export async function pickWorkflowFile(
  pick: () => Promise<string | undefined>,
  logger: Pick<MainLogger, 'info' | 'error'>,
): Promise<{ name: string; text: string } | undefined> {
  logger.info('main/workflows', 'Opening workflow file picker')
  try {
    const path = await pick()
    if (path === undefined) {
      logger.info('main/workflows', 'Workflow import cancelled')
      return undefined
    }
    const file = await open(path, 'r')
    try {
      if (!(await file.stat()).isFile()) throw new Error('Select a regular workflow JSON file.')
      const buffer = Buffer.alloc(MAX_WORKFLOW_BYTES + 1)
      let bytes = 0
      while (bytes < buffer.length) {
        const result = await file.read(buffer, bytes, buffer.length - bytes, bytes)
        if (result.bytesRead === 0) break
        bytes += result.bytesRead
      }
      if (bytes > MAX_WORKFLOW_BYTES) throw new Error('Workflow JSON exceeds the 10 MiB import limit.')
      logger.info('main/workflows', 'Workflow file read', { filename: basename(path), bytes })
      return { name: basename(path), text: buffer.subarray(0, bytes).toString('utf8') }
    } finally {
      await file.close()
    }
  } catch (error) {
    logger.error('main/workflows', 'Workflow file import failed', { error: String(error) })
    throw error
  }
}
