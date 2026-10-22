import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = React.ComponentProps<typeof Input> & { label: string; error?: string; hint?: string }

/** Label, input and its error, wired for screen readers. Inputs are 16px on phones so iOS does not zoom. */
export function FormField({ label, error, hint, id, ...props }: Props) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\W+/g, '-')
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={fieldId}>{label}</Label>
      <Input id={fieldId} aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined} className="h-11 text-base sm:text-sm" {...props} />
      {hint && !error ? <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${fieldId}-error`} className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
