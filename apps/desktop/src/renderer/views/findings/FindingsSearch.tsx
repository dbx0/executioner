import type { JSX } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '../../components/ui/input.js'

/** The search pill in the Findings toolbar: narrows the loaded list as you type. */
export function FindingsSearch({
  query,
  onQueryChange,
}: {
  query: string
  onQueryChange: (query: string) => void
}): JSX.Element {
  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        strokeWidth={2}
      />
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search findings"
        aria-label="Search findings"
        className="h-8 w-56 pl-8 pr-8 text-[13px]"
      />
      {query !== '' && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onQueryChange('')}
          className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-glass-active hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X className="size-3" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
