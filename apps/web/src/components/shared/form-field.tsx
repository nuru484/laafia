'use client'

import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type InputProps = React.ComponentProps<typeof Input>
type Props = InputProps & { label: string; error?: string; hint?: string; required?: boolean }

/** A label for any control; `required` adds the red asterisk that `RequiredNote` explains. */
export function FieldLabel({ htmlFor, children, required }: { htmlFor?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <Label htmlFor={htmlFor}>
      {children}{required ? <span className="text-destructive" aria-hidden> *</span> : null}{required ? <span className="sr-only"> (required)</span> : null}
    </Label>
  )
}

/** Opens a form that has required fields: says what the asterisk means. */
export function RequiredNote() {
  return <p className="text-xs text-muted-foreground"><span className="text-destructive">*</span> required</p>
}

/** A password input with a show/hide toggle; the button stays a 44px target inside the field. */
export function PasswordInput({ className, ...props }: Omit<InputProps, 'type'>) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pr-12', className)} />
      <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {shown ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  )
}

/** Label, input and its error, wired for screen readers. Inputs are 16px on phones so iOS does not zoom. */
export function FormField({ label, error, hint, id, type, required, ...props }: Props) {
  const fieldId = id ?? props.name ?? label.toLowerCase().replace(/\W+/g, '-')
  const input = { id: fieldId, 'aria-invalid': !!error, 'aria-required': required || undefined, 'aria-describedby': error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined, className: 'h-11 text-base sm:text-sm', ...props }
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={fieldId} required={required}>{label}</FieldLabel>
      {type === 'password' ? <PasswordInput {...input} /> : <Input type={type} {...input} />}
      {hint && !error ? <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${fieldId}-error`} className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
