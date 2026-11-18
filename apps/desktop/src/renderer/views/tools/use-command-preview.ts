import { useEffect, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { nodesApi, type NodeListing } from '../../api/nodes.js'
import { apiErrorMessage } from '../../lib/api-error.js'
import type { CommandPreviewState } from './CommandPreview.js'

/**
 * The command a run of `node` would execute, as the form stands.
 *
 * The engine builds the argv, so the preview is exactly what a run executes.
 * Debounced, since every keystroke in a param changes it. The answer is tagged
 * with the tool it was built for, so a stale one never shows under another
 * tool while the next is on its way.
 */
export function useCommandPreview(
  client: AxiosInstance | null,
  node: NodeListing | null,
  targetIds: string[],
  params: Record<string, unknown>,
): CommandPreviewState {
  const [preview, setPreview] = useState<{ nodeId: string; state: CommandPreviewState } | null>(null)
  useEffect(() => {
    if (client === null || node === null) return
    let cancelled = false
    const timer = setTimeout(() => {
      void nodesApi(client)
        .preview(node.id, { params, ...(targetIds[0] === undefined ? {} : { targetId: targetIds[0] }) })
        .then((argv) => ({ argv }))
        .catch((e: unknown) => ({ error: apiErrorMessage(e, 'The engine could not build it.') }))
        .then((state) => {
          if (!cancelled) setPreview({ nodeId: node.id, state })
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, node, targetIds, params])
  return preview !== null && preview.nodeId === node?.id ? preview.state : null
}
