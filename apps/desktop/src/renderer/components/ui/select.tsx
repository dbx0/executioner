import type { JSX } from 'react'
import * as React from 'react'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils.js'
import { POPOVER_ITEM, POPOVER_SURFACE } from './surface.js'

export interface SelectOption {
  value: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
}

export interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  className?: string
  contentClassName?: string
}

/**
 * A styled dropdown built on `@radix-ui/react-select` (proper listbox
 * semantics, typeahead, keyboard nav, trigger-width matching). The trigger is
 * a pill on glass, the same shape as the app's Input; the content is the shared
 * popover surface, and the chosen row keeps the brighter selected fill.
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  className,
  contentClassName,
}: SelectProps): JSX.Element {
  const selected = options.find((o) => o.value === value)
  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={onValueChange}
      {...(disabled === undefined ? {} : { disabled })}
    >
      <SelectPrimitive.Trigger
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-control border border-glass-border bg-glass px-3.5 text-[13px] outline-none transition-colors',
          'hover:bg-glass-strong data-[state=open]:bg-glass-strong',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          'data-[placeholder]:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.icon}
          <SelectPrimitive.Value {...(placeholder === undefined ? {} : { placeholder })} />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            POPOVER_SURFACE,
            'z-[80] animate-fade-in overflow-hidden p-1 text-[13px]',
            '[min-width:var(--radix-select-trigger-width)]',
            contentClassName,
          )}
        >
          <SelectPrimitive.Viewport className="scrollbar-sleek max-h-[min(18rem,var(--radix-select-content-available-height))]">
            {options.map((opt) => (
              <SelectPrimitive.Item
                key={opt.value}
                value={opt.value}
                {...(opt.disabled === undefined ? {} : { disabled: opt.disabled })}
                className={cn(
                  POPOVER_ITEM,
                  'data-[state=checked]:bg-glass-active data-[state=checked]:font-medium [&_svg]:size-4',
                )}
              >
                {opt.icon}
                <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto">
                  <Check className="size-3.5" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
