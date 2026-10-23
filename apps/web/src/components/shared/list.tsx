'use client'

import { ChevronDown, MoreHorizontal, Search, SlidersHorizontal, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/**
 * The phone form of a table (below md): rows edge to edge with hairline dividers, so a phone has one inset level,
 * not a box per row inside the page padding. From sm it takes a frame again.
 */
export function RowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('-mx-4 flex flex-col divide-y border-y bg-card sm:mx-0 sm:border md:hidden', className)}>{children}</ul>
}

export function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <li className={cn('flex min-w-0 flex-col gap-1.5 px-4 py-3', className)}>{children}</li>
}

export type Action = { label: string; onSelect: () => void; destructive?: boolean }

/**
 * Row actions behind one control. `compact` is the icon form for table cells; the default is a labelled button
 * that sits on its own line under the row's text on phones.
 */
export function ActionsMenu({ label, actions, compact }: { label: string; actions: Action[]; compact?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={compact
          ? <Button variant="ghost" size="icon" aria-label={`Actions for ${label}`} className="size-9" />
          : <Button variant="outline" className="h-11 self-start" aria-label={`Actions for ${label}`} />}>
        {compact ? <MoreHorizontal className="size-4" aria-hidden /> : <>Actions <ChevronDown className="size-4" aria-hidden /></>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? 'end' : 'start'} className="min-w-44">
        {actions.map((a) => (
          <DropdownMenuItem key={a.label} variant={a.destructive ? 'destructive' : 'default'} onClick={a.onSelect} className="min-h-10 px-2.5">
            {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** True when every word of the query appears in one of the fields (names, codes, phone numbers). */
export function matches(query: string, ...fields: (string | number | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = fields.filter((f) => f !== null && f !== undefined).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** The list's search: always in view, full width on phones, with a clear button once something is typed. */
export function SearchInput({ value, onChange, placeholder, label = 'Search', className }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; className?: string }) {
  return (
    <div className={cn('relative', className)} role="search">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        className="h-11 pr-11 pl-9 text-base sm:text-sm [&::-webkit-search-cancel-button]:hidden" />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <X className="size-4" aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

/** Filters sit behind one toggle on phones (with how many are set) and in a row from sm. `search` stays in view. */
export function FilterBar({ active, children, columns = 3, search }: { active: number; children: React.ReactNode; columns?: 2 | 3; search?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4 flex flex-col gap-3">
      {search}
      <Button variant="outline" className="h-11 w-full justify-between sm:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" aria-hidden />Filters{active ? ` (${active})` : ''}</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </Button>
      <div className={cn('grid gap-3', columns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2', !open && 'max-sm:hidden')}>{children}</div>
    </div>
  )
}
