import * as React from 'react'
import { Search } from 'lucide-react'
import { Input } from '../../components/ui/input.js'
import { cn } from '../../lib/utils.js'

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** `sm` is the compact field inside a panel's own toolbar. */
  size?: 'sm' | 'md'
  /** Classes for the wrapper (width, flex); the field always fills it. */
  wrapperClassName?: string
  /** Something pinned at the right edge, such as a shortcut hint. */
  trailing?: React.ReactNode
}

/** The app Input as a search box: a leading glass and the `searchbox` role. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ size = 'md', wrapperClassName, trailing, className, ...props }, ref) => (
    <div className={cn('relative min-w-0', wrapperClassName)}>
      <Search
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground',
          size === 'md' ? 'left-3 size-3.5' : 'left-2.5 size-3',
        )}
      />
      <Input
        ref={ref}
        type="search"
        className={cn(
          'peer',
          size === 'md' ? 'h-8 pl-8 text-[13px]' : 'h-7 pl-7 text-[12px]',
          trailing !== undefined && 'pr-8',
          className,
        )}
        {...props}
      />
      {trailing}
    </div>
  ),
)
SearchField.displayName = 'SearchField'
