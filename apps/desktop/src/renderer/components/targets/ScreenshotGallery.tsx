import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ScreenshotItem } from '../../api/targets.js'
import { formatDate } from './fact-sections.js'

export function ScreenshotGallery({ items }: { items: ScreenshotItem[] }): JSX.Element {
  const [lightbox, setLightbox] = useState<ScreenshotItem | null>(null)

  useEffect(() => {
    if (lightbox === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  if (items.length === 0) {
    return <p className="py-2 text-[12.5px] text-muted-foreground">No screenshots captured</p>
  }

  return (
    <>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {items.map((item) => (
          <div key={item.factId} className="overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setLightbox(item)}
              className="block w-full cursor-zoom-in bg-surface-1"
            >
              <img
                src={item.dataUrl}
                alt={item.url ?? 'screenshot'}
                loading="lazy"
                className="h-40 w-full object-cover object-top"
              />
            </button>
            <div className="flex flex-col gap-0.5 px-2 py-1.5">
              {item.url !== undefined && item.url !== '' && (
                <span className="truncate font-mono text-[11px]" title={item.url}>
                  {item.url}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">{formatDate(item.collectedAt)}</span>
            </div>
          </div>
        ))}
      </div>

      {lightbox !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            aria-label="Close"
            className="absolute right-4 top-4 rounded-md p-1 text-white/80 hover:text-white"
            onClick={() => setLightbox(null)}
          >
            <X className="size-5" />
          </button>
          <img
            src={lightbox.dataUrl}
            alt={lightbox.url ?? 'screenshot'}
            className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
