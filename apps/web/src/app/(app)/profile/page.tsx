'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { KeyRound, Pencil } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField, RequiredNote } from '@/components/shared/form-field'
import { PageHeader } from '@/components/shared/page'
import { Button } from '@/components/ui/button'
import { ROLE_LABEL } from '@/lib/nav'
import { errorCode, errorMessage } from '@/redux/api'
import { useChangeMyPasswordMutation, useMeQuery, useUpdateMeMutation } from '@/redux/endpoints'
import type { User } from '@/types/api'

const details = z
  .object({
    name: z.string().trim().min(1, 'Enter your name'),
    email: z.union([z.literal(''), z.email('Enter a valid email')]),
    phone: z.string().trim().refine((v) => v === '' || v.replace(/\D/g, '').length >= 9, 'Enter a valid phone number'),
  })
  .refine((v) => v.email || v.phone, { message: 'Keep an email or a phone number to sign in with', path: ['email'] })

const password = z
  .object({ current: z.string().min(1, 'Enter your current password'), next: z.string().min(10, 'At least 10 characters'), again: z.string() })
  .refine((v) => v.next === v.again, { message: 'The two new passwords do not match', path: ['again'] })

/** A section of the profile: heading, a note, and its one action on the right of the heading. */
function Section({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="-mx-4 border-y bg-card sm:mx-0 sm:border" aria-labelledby={`${title}-h`}>
      <div className="flex items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id={`${title}-h`} className="text-base font-semibold">{title}</h2>
          {note ? <p className="mt-0.5 text-sm text-muted-foreground">{note}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-4 py-4 sm:px-6">{children}</div>
    </section>
  )
}

/** Label above value below 480px, side by side from there; values never push the label out. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 min-[480px]:flex-row min-[480px]:gap-4">
      <dt className="text-sm text-muted-foreground min-[480px]:w-36 min-[480px]:shrink-0">{label}</dt>
      <dd className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}

/** Your own account: read-only until you choose to edit a section. Role and workplace stay with the district admin. */
export default function ProfilePage() {
  const { data } = useMeQuery()
  const user = data!.user
  const initials = user.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const place = user.facility?.name ?? (user.district ? `${user.district.name} district` : null)
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Your profile" description="Your details and password. Your role and where you work are set by the district admin." />
      <div className="flex items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center bg-primary text-xl font-semibold text-primary-foreground" aria-hidden>{initials}</span>
        <div className="min-w-0">
          <p className="line-clamp-2 text-xl font-semibold [overflow-wrap:anywhere]">{user.name}</p>
          <p className="text-sm text-muted-foreground">{ROLE_LABEL[user.role]}{place ? ` · ${place}` : ''}</p>
          <p className="text-xs text-muted-foreground">Last signed in {user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'now'}</p>
        </div>
      </div>
      <Details user={user} />
      <Password />
    </div>
  )
}

function Details({ user }: { user: User }) {
  const [editing, setEditing] = useState(false)
  const [save, { isLoading }] = useUpdateMeMutation()
  const form = useForm<z.infer<typeof details>>({ resolver: zodResolver(details), values: { name: user.name, email: user.email ?? '', phone: user.phone ?? '' } })
  const e = form.formState.errors
  async function submit(v: z.infer<typeof details>) {
    try {
      await save({ name: v.name, email: v.email || null, phone: v.phone || null }).unwrap()
      toast.success('Your details are saved.')
      setEditing(false)
    } catch (err) {
      toast.error(errorCode(err) === 'conflict' ? 'That email or phone already belongs to another account.' : errorMessage(err))
    }
  }
  const edit = <Button variant="outline" className="h-10 shrink-0" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden />Edit</Button>
  return (
    <Section title="Details" note="You sign in with the email or the phone number." action={editing ? null : edit}>
      {editing ? (
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <RequiredNote />
          <FormField required label="Full name" placeholder="e.g. Abena Mensah" autoComplete="name" autoFocus {...form.register('name')} error={e.name?.message} />
          <div className="grid gap-4 @lg/main:grid-cols-2">
            <FormField label="Email" type="email" placeholder="e.g. abena@example.com" autoComplete="email" {...form.register('email')} error={e.email?.message} />
            <FormField label="Phone" type="tel" placeholder="e.g. 024 123 4567" autoComplete="tel" {...form.register('phone')} error={e.phone?.message} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 px-6" disabled={isLoading || !form.formState.isDirty}>{isLoading ? 'Saving' : 'Save details'}</Button>
            <Button type="button" variant="outline" className="h-11 px-6" onClick={() => { form.reset(); setEditing(false) }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <dl className="flex flex-col divide-y">
          <Fact label="Full name" value={user.name} />
          <Fact label="Email" value={user.email ?? <span className="font-normal text-muted-foreground">Not set</span>} />
          <Fact label="Phone" value={user.phone ?? <span className="font-normal text-muted-foreground">Not set</span>} />
        </dl>
      )}
    </Section>
  )
}

function Password() {
  const [editing, setEditing] = useState(false)
  const [change, { isLoading }] = useChangeMyPasswordMutation()
  const form = useForm<z.infer<typeof password>>({ resolver: zodResolver(password), defaultValues: { current: '', next: '', again: '' } })
  const e = form.formState.errors
  async function submit(v: z.infer<typeof password>) {
    try {
      await change({ current_password: v.current, new_password: v.next }).unwrap()
      form.reset()
      setEditing(false)
      toast.success('Password changed. Any other device you were signed in on is signed out.')
    } catch (err) {
      if (errorCode(err) === 'wrong_password') form.setError('current', { message: 'That is not your current password' })
      else toast.error(errorMessage(err))
    }
  }
  const change_ = <Button variant="outline" className="h-10 shrink-0" onClick={() => setEditing(true)}><KeyRound className="size-4" aria-hidden />Change</Button>
  return (
    <Section title="Password" note="Changing it signs you out everywhere else." action={editing ? null : change_}>
      {editing ? (
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <RequiredNote />
          <FormField required label="Current password" type="password" placeholder="Your current password" autoComplete="current-password" autoFocus {...form.register('current')} error={e.current?.message} />
          <div className="grid gap-4 @lg/main:grid-cols-2">
            <FormField required label="New password" type="password" placeholder="At least 10 characters" autoComplete="new-password" {...form.register('next')} error={e.next?.message} />
            <FormField required label="New password again" type="password" placeholder="The same again" autoComplete="new-password" {...form.register('again')} error={e.again?.message} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="h-11 px-6" disabled={isLoading}>{isLoading ? 'Changing' : 'Change password'}</Button>
            <Button type="button" variant="outline" className="h-11 px-6" onClick={() => { form.reset(); setEditing(false) }}>Cancel</Button>
          </div>
        </form>
      ) : (
        <dl className="flex flex-col"><Fact label="Password" value={<span className="tracking-[0.3em]">••••••••••</span>} /></dl>
      )}
    </Section>
  )
}
