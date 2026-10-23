import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/*
 * Loading states drawn in the shape of what is coming: the same rows, columns, badges and tiles, so the page does
 * not jump when the data lands. Each page passes the widths of its own content.
 */

function Busy({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading</span>
      <div aria-hidden>{children}</div>
    </div>
  )
}

/** Phone rows (below md). `lines` is one array of bar widths per text line; `h-5` bars stand in for badges. */
export function RowListSkeleton({ lines, rows = 5, className }: { lines: string[][]; rows?: number; className?: string }) {
  return (
    <ul className={cn('-mx-4 flex flex-col divide-y border-y sm:mx-0 sm:rounded-lg sm:border md:hidden', className)}>
      {Array.from({ length: rows }, (_, r) => (
        <li key={r} className="flex flex-col gap-2.5 px-4 py-3.5">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center justify-between gap-3">
              {line.map((w, j) => <Skeleton key={j} className={cn(i === 0 ? 'h-4' : 'h-3.5', w)} />)}
            </div>
          ))}
        </li>
      ))}
    </ul>
  )
}

/** A table from md: header labels and rows of bars at each column's width, on the real column template. */
export function TableSkeleton({ columns, template, rows = 6 }: { columns: string[]; template: string; rows?: number }) {
  return (
    <div className="hidden overflow-hidden border md:block">
      <div className="grid h-11 items-center gap-4 border-b px-3" style={{ gridTemplateColumns: template }}>
        {columns.map((_, i) => <Skeleton key={i} className="h-3 w-14" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="grid h-[52px] items-center gap-4 border-b px-3 last:border-b-0" style={{ gridTemplateColumns: template }}>
          {columns.map((w, i) => <Skeleton key={i} className={cn('h-4', w)} />)}
        </div>
      ))}
    </div>
  )
}

/** A list that stays a list at every width (logs). */
export function LogSkeleton({ lines, rows }: { lines: string[][]; rows?: number }) {
  return <Busy><RowListSkeleton lines={lines} rows={rows} className="md:flex" /></Busy>
}

/** A list page: phone rows below md, the table from md. */
export function ListSkeleton(props: { lines: string[][]; columns: string[]; template: string; rows?: number }) {
  return (
    <Busy>
      <RowListSkeleton lines={props.lines} rows={props.rows} />
      <TableSkeleton columns={props.columns} template={props.template} rows={props.rows} />
    </Busy>
  )
}

export function HeaderSkeleton({ action }: { action?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {action ? <Skeleton className="h-11 w-44" /> : null}
    </div>
  )
}

export function OverviewSkeleton() {
  return (
    <Busy>
      <HeaderSkeleton action />
      <div className="grid grid-cols-1 gap-3 min-[340px]:grid-cols-2 @4xl/main:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 border p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 @4xl/main:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="-mx-4 flex flex-col gap-3 border-y p-4 sm:mx-0 sm:rounded-lg sm:border">
            <Skeleton className="h-4 w-36" />
            {Array.from({ length: 3 }, (_, j) => (
              <div key={j} className="flex justify-between gap-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-12" /></div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-6 @4xl/main:grid-cols-2">
        <div className="-mx-4 flex flex-col gap-4 border-y p-4 sm:mx-0 sm:rounded-lg sm:border">
          <Skeleton className="h-4 w-32" />
          <div className="flex h-40 items-end gap-1">
            {[30, 45, 20, 60, 35, 80, 50, 25, 70, 40, 55, 90, 35, 65].map((h, i) => <Skeleton key={i} className="flex-1" style={{ height: `${h}%` }} />)}
          </div>
        </div>
        <div className="-mx-4 flex flex-col gap-3 border-y p-4 sm:mx-0 sm:rounded-lg sm:border">
          <Skeleton className="h-4 w-40" />
          {[60, 85, 40, 45, 25, 95, 20].map((w, i) => (
            <div key={i} className="flex items-center gap-3"><Skeleton className="h-3.5 w-24 shrink-0" /><Skeleton className="h-3.5" style={{ width: `${w * 0.5}%` }} /></div>
          ))}
        </div>
      </div>
    </Busy>
  )
}

export function ReferralDetailSkeleton() {
  return (
    <Busy className="flex flex-col gap-6">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-col gap-3">
        <div className="flex gap-2"><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-36" /></div>
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 @3xl/main:grid-cols-2">
        <div className="-mx-4 flex flex-col gap-2.5 border-y p-4 sm:mx-0 sm:rounded-lg sm:border">
          <Skeleton className="h-4 w-28" />
          {[70, 85, 55, 60].map((w, i) => <Skeleton key={i} className="h-10" style={{ width: `${w}%` }} />)}
        </div>
        <div className="-mx-4 flex flex-col gap-3 border-y p-4 sm:mx-0 sm:rounded-lg sm:border">
          <Skeleton className="h-4 w-20" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3"><Skeleton className="size-3 rounded-full" /><Skeleton className="h-4 w-32" /><Skeleton className="ml-auto h-3.5 w-20" /></div>
          ))}
        </div>
      </div>
    </Busy>
  )
}

/** The signed-in shell while the session loads: sidebar from lg, the phone bar below it. */
export function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <div className="hidden h-dvh flex-col gap-3 border-r bg-sidebar p-4 lg:flex">
        <Skeleton className="mb-3 h-8 w-28" />
        {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
      <div className="flex h-14 items-center gap-3 border-b px-4 lg:hidden"><Skeleton className="size-9" /><Skeleton className="h-6 w-24" /></div>
      <div className="px-4 py-6 sm:px-6 lg:px-8"><HeaderSkeleton /><RowListSkeleton lines={[['w-40', 'h-5 w-20'], ['w-full'], ['w-1/2']]} /></div>
    </div>
  )
}
