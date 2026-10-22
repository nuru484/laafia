'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export type Option = { value: string; label: string }

/** A labelled single-choice filter; the trigger shows the option's label, not its value. */
export function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Option[]; onChange: (v: string) => void }) {
  return (
    <Select items={options} value={value} onValueChange={(v) => onChange((v as string | null) ?? options[0]!.value)}>
      <SelectTrigger aria-label={label} className="h-11 w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}
