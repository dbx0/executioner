import { useEffect, useMemo, useState } from 'react'
import type { AxiosInstance } from 'axios'
import { nodesApi, type NodeListing } from '../../api/nodes.js'
import { buildCatalog, type CatalogEntry } from '../../lib/node-catalog.js'

/**
 * The node catalog the editor builds from: the engine's tool listings plus the
 * built-in nodes. `listingsLoaded` stays false until the engine has answered
 * (or failed to answer) for its tool list. The built-in nodes are known from
 * the start, so the catalog is never empty and cannot say whether the tools
 * have arrived yet.
 */
export function useEditorCatalog(client: AxiosInstance): {
  listings: NodeListing[]
  listingsLoaded: boolean
  catalog: CatalogEntry[]
} {
  const [listings, setListings] = useState<NodeListing[]>([])
  const [listingsLoaded, setListingsLoaded] = useState(false)

  useEffect(() => {
    void nodesApi(client)
      .list()
      .then(setListings)
      .catch(() => setListings([]))
      .finally(() => setListingsLoaded(true))
  }, [client])

  const catalog = useMemo(() => buildCatalog(listings), [listings])
  return { listings, listingsLoaded, catalog }
}
