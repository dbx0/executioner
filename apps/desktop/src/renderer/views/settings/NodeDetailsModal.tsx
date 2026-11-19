import type { JSX, ReactNode } from 'react'
import { Button } from '../../components/ui/button.js'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../components/ui/dialog.js'
import { categoryColor, type CatalogEntry } from '../../lib/node-catalog.js'
import type { ParamSpec } from '../../components/canvas/ParamDrawer.js'
import { cn } from '../../lib/utils.js'
import { Tag } from './parts.js'

/** Title-case a target kind for display (ip → IP, url → URL, cidr → CIDR). */
function targetKindLabel(kind: string): string {
  const upper = new Set(['ip', 'url', 'cidr', 'dns', 'http'])
  if (upper.has(kind)) return kind.toUpperCase()
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** A readable type label for a parameter. */
function paramTypeLabel(p: ParamSpec): string {
  if (p.oneOf !== undefined) return 'Options'
  if (p.type === 'boolean') return 'Boolean'
  if (p.type === 'number') return 'Number'
  return 'Text'
}

/** A labeled section inside the details modal. */
function DetailBlock({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

/** Small pill for a value like a target kind or an output field. */
function Chip({ children, mono = false }: { children: ReactNode; mono?: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-glass-border px-2 py-0.5 text-[11px] text-muted-foreground',
        mono && 'font-mono',
      )}
    >
      {children}
    </span>
  )
}

/** The node details modal: description, input, parameters, and output. */
export function NodeDetailsModal({ entry, onClose }: { entry: CatalogEntry; onClose: () => void }): JSX.Element {
  const accepts = entry.accepts ?? []
  const outputs = entry.outputs ?? []
  return (
    <Dialog onClose={onClose} label={entry.label} className="w-[560px]">
      <DialogHeader
        icon={<CategoryDot category={entry.category} className="size-2.5" />}
        title={
          <span className="flex items-center gap-2">
            <span className="truncate">{entry.label}</span>
            <Tag>{entry.category}</Tag>
            <span className="ml-1 truncate font-mono text-[11px] font-normal text-muted-foreground">{entry.type}</span>
          </span>
        }
        closeButton
      />

      <DialogBody className="flex flex-col gap-5">
        <DetailBlock title="Description">
          <p className="text-[13px] text-foreground">{entry.description ?? 'No description provided.'}</p>
        </DetailBlock>

        <DetailBlock title="Input">
          {accepts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {accepts.map((k) => (
                <Chip key={k}>{targetKindLabel(k)}</Chip>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Runs against the workflow target and any upstream node output.</p>
          )}
        </DetailBlock>

        <DetailBlock title="Parameters">
          {entry.params.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No parameters.</p>
          ) : (
            <div className="flex flex-col divide-y divide-glass-border rounded-[14px] border border-glass-border bg-glass">
              {entry.params.map((p) => (
                <div key={p.name} className="flex flex-col gap-1 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-medium">{p.name}</span>
                    <Chip>{paramTypeLabel(p)}</Chip>
                    {p.required === true && (
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--destructive)_16%,transparent)] px-2 py-0.5 text-[10px] font-medium text-destructive">
                        Required
                      </span>
                    )}
                    {p.default !== undefined && p.default !== '' && (
                      <span className="text-[11px] text-muted-foreground">
                        Default: <span className="font-mono">{String(p.default)}</span>
                      </span>
                    )}
                  </div>
                  {p.description !== undefined && p.description !== '' && (
                    <p className="text-[12px] text-muted-foreground">{p.description}</p>
                  )}
                  {p.oneOf !== undefined && p.oneOf.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.oneOf.map((o) => (
                        <Chip key={String(o)} mono>
                          {String(o)}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DetailBlock>

        <DetailBlock title="Output">
          {outputs.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {outputs.map((o) => (
                <Chip key={o} mono>
                  {o}
                </Chip>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground">Structured output varies by result.</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Reference a field downstream as <span className="font-mono">{'{{ nodes.<id>.<field> }}'}</span>, or the raw text as{' '}
            <span className="font-mono">{'{{ nodes.<id>.output }}'}</span>.
          </p>
        </DetailBlock>
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * The dot that marks a node's category. The color is data (one per category,
 * from the node catalog), so it is the one inline style here.
 */
export function CategoryDot({ category, className }: { category: string; className?: string }): JSX.Element {
  return (
    <span
      className={cn('shrink-0 rounded-full', className)}
      style={{ backgroundColor: categoryColor(category) }}
      aria-hidden
    />
  )
}
