'use client'

import { useState } from 'react'

/** Columns for one series over time. Hover or focus a column for its value; the table below carries the same data. */
export function DailyColumns({ data, label }: { data: { day: string; value: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const h = 140
  const fmt = (day: string) => new Date(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  const active = hover !== null ? data[hover] : null
  return (
    <figure className="flex flex-col gap-2">
      <div className="h-5 text-sm text-muted-foreground" aria-live="polite">{active ? `${fmt(active.day)}: ${active.value} ${label}` : `Hover a day for its count`}</div>
      <div className="relative" style={{ height: h }}>
        <div className="absolute inset-x-0 bottom-0 border-t border-border" aria-hidden />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {data.map((d, i) => (
            <button
              key={d.day}
              type="button"
              className="group flex h-full flex-1 items-end justify-center focus-visible:outline-none"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${fmt(d.day)}: ${d.value} ${label}`}
            >
              <span
                className="w-full max-w-6 rounded-t-[4px] bg-chart-1 transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-ring"
                style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0, opacity: hover === null || hover === i ? 1 : 0.45 }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground" aria-hidden>
        <span>{data[0] ? fmt(data[0].day) : ''}</span>
        <span>{data.at(-1) ? fmt(data.at(-1)!.day) : ''}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr><th className="py-1 font-medium">Day</th><th className="py-1 text-right font-medium">{label}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.day} className="border-t"><td className="py-1">{fmt(d.day)}</td><td className="py-1 text-right tabular-nums">{d.value}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  )
}

/** Horizontal bars with the value written at the bar end, so no axis or legend is needed. */
export function LabelledBars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_1fr] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-4 rounded-r-[4px] bg-chart-1" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 2 : 0 }} aria-hidden />
            <span className="tabular-nums">{r.value}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
