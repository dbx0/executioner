import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ScreenshotItem } from '../../api/targets.js'
import { Button } from '../ui/button.js'
import { formatDate } from './fact-sections.js'
import { Hint } from './Hint.js'

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
    return <p className="text-[12.5px] text-muted-foreground">No screenshots captured</p>
  }

  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
        {items.map((item) => (
          <div key={item.factId} className="overflow-hidden rounded-lg border border-glass-border">
            <button
              type="button"
              onClick={() => setLightbox(item)}
              className="block w-full cursor-zoom-in bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <img
                src={item.dataUrl}
                alt={item.url ?? 'screenshot'}
                loading="lazy"
                className="h-40 w-full object-cover object-top"
              />
            </button>
            <div className="flex flex-col gap-0.5 px-2.5 py-2">
              {item.url !== undefined && item.url !== '' && (
                <Hint label={item.url}>
                  <span className="truncate font-mono text-[11px]">{item.url}</span>
                </Hint>
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
          <Button
            variant="glass"
            size="icon-sm"
            aria-label="Close"
            className="absolute right-4 top-4"
            onClick={() => setLightbox(null)}
          >
            <X />
          </Button>
          <img
            src={lightbox.dataUrl}
            alt={lightbox.url ?? 'screenshot'}
            className="max-h-full max-w-full rounded-panel object-contain shadow-floating"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
