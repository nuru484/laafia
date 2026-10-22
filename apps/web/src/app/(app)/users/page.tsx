'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FilterSelect } from '@/components/shared/filter-select'
import { FormField } from '@/components/shared/form-field'
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/shared/page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ROLE_LABEL } from '@/lib/nav'
import { errorMessage } from '@/redux/api'
import { useCreateUserMutation, useFacilitiesQuery, useSetUserActiveMutation, useSetUserPasswordMutation, useUsersQuery } from '@/redux/endpoints'
import type { Role, User } from '@/types/api'

const schema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name'),
    email: z.union([z.literal(''), z.email('Enter a valid email')]),
    phone: z.string().trim().refine((v) => v === '' || v.replace(/\D/g, '').length >= 9, 'Enter a valid phone number'),
    role: z.enum(['district_admin', 'supervisor', 'facility_staff']),
    facility_code: z.string(),
    password: z.string().min(10, 'At least 10 characters'),
  })
  .refine((v) => v.email || v.phone, { message: 'Give an email or a phone number to sign in with', path: ['email'] })
  .refine((v) => v.role !== 'facility_staff' || v.facility_code, { message: 'Choose the facility', path: ['facility_code'] })

type Form = z.infer<typeof schema>

export default function UsersPage() {
  const { data, error, isLoading, refetch } = useUsersQuery()
  const { data: facs } = useFacilitiesQuery()
  const [adding, setAdding] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)
  const [setActive] = useSetUserActiveMutation()
  const facilityName = new Map((facs?.facilities ?? []).map((f) => [f.id, f.name]))

  async function toggle(u: User) {
    try {
      await setActive({ id: u.id, active: !u.active }).unwrap()
      toast.success(u.active ? `${u.name} can no longer sign in.` : `${u.name} can sign in again.`)
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  const scopeOf = (u: User) => (u.role === 'facility_staff' ? facilityName.get(u.facility_id ?? '') ?? 'Facility' : 'Whole district')

  return (
    <>
      <PageHeader title="Users" description="People who sign in to this dashboard. Phones are activated separately, under Phones." actions={<Button className="h-11" onClick={() => setAdding(true)}>Add user</Button>} />
      {isLoading ? <LoadingRows /> : error ? <ErrorState message={errorMessage(error)} onRetry={refetch} /> : !data?.users.length ? <EmptyState title="No users yet" /> : (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.users.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 font-medium [overflow-wrap:anywhere]">{u.name}</p>
                  {!u.active ? <Badge variant="secondary">Deactivated</Badge> : null}
                </div>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{ROLE_LABEL[u.role]} · {scopeOf(u)}</p>
                <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{u.email ?? u.phone}</p>
                <div className="flex gap-2">
                  <Button variant="outline" className="h-11 flex-1" onClick={() => setResetting(u)}>Set password</Button>
                  <Button variant="outline" className="h-11 flex-1" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Sign-in</TableHead><TableHead>Role</TableHead><TableHead>Scope</TableHead><TableHead>Last sign-in</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.name}{!u.active ? <Badge variant="secondary" className="ml-2">Deactivated</Badge> : null}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email ?? u.phone}</TableCell>
                    <TableCell>{ROLE_LABEL[u.role]}</TableCell>
                    <TableCell className="text-muted-foreground">{scopeOf(u)}</TableCell>
                    <TableCell className="text-muted-foreground">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => setResetting(u)}>Set password</Button>
                        <Button variant="outline" size="sm" onClick={() => toggle(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <AddUser open={adding} onOpenChange={setAdding} facilities={(facs?.facilities ?? []).map((f) => ({ value: f.code, label: f.name }))} />
      <ResetPassword user={resetting} onClose={() => setResetting(null)} />
    </>
  )
}

function AddUser({ open, onOpenChange, facilities }: { open: boolean; onOpenChange: (o: boolean) => void; facilities: { value: string; label: string }[] }) {
  const [create, { isLoading }] = useCreateUserMutation()
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: '', email: '', phone: '', role: 'facility_staff', facility_code: '', password: '' } })
  const role = form.watch('role')
  const e = form.formState.errors

  async function submit(v: Form) {
    try {
      await create({ name: v.name, password: v.password, role: v.role, ...(v.email ? { email: v.email } : {}), ...(v.phone ? { phone: v.phone } : {}), ...(v.role === 'facility_staff' ? { facility_code: v.facility_code } : {}) }).unwrap()
      toast.success(`${v.name} can now sign in.`)
      form.reset()
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Share the password with them in person; they can sign in with the email or the phone number.</DialogDescription>
        </DialogHeader>
        <form id="add-user" onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <FormField label="Full name" {...form.register('name')} error={e.name?.message} autoComplete="off" />
          <FormField label="Email" type="email" {...form.register('email')} error={e.email?.message} autoComplete="off" />
          <FormField label="Phone" type="tel" {...form.register('phone')} error={e.phone?.message} autoComplete="off" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Role</span>
            <Controller control={form.control} name="role" render={({ field }) => (
              <FilterSelect label="Role" value={field.value} onChange={(v) => field.onChange(v as Role)} options={[
                { value: 'facility_staff', label: 'Facility staff: inbox for one facility' },
                { value: 'supervisor', label: 'Supervisor: district reports, read only' },
                { value: 'district_admin', label: 'District admin: everything' },
              ]} />
            )} />
          </div>
          {role === 'facility_staff' ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Facility</span>
              <Controller control={form.control} name="facility_code" render={({ field }) => (
                <FilterSelect label="Facility" value={field.value} onChange={field.onChange} options={[{ value: '', label: 'Choose a facility' }, ...facilities]} />
              )} />
              {e.facility_code ? <p className="text-sm text-destructive">{e.facility_code.message}</p> : null}
            </div>
          ) : null}
          <FormField label="Password" type="password" {...form.register('password')} error={e.password?.message} hint="At least 10 characters." autoComplete="new-password" />
        </form>
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" form="add-user" className="h-11" disabled={isLoading}>{isLoading ? 'Adding' : 'Add user'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ResetPassword({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [setPassword, { isLoading }] = useSetUserPasswordMutation()
  const [value, setValue] = useState('')
  const tooShort = value.length > 0 && value.length < 10

  async function save() {
    if (!user) return
    try {
      await setPassword({ id: user.id, password: value }).unwrap()
      toast.success(`New password set for ${user.name}.`)
      setValue('')
      onClose()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) { setValue(''); onClose() } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a new password</DialogTitle>
          <DialogDescription>{user?.name}</DialogDescription>
        </DialogHeader>
        <FormField label="New password" type="password" value={value} onChange={(e) => setValue(e.target.value)} error={tooShort ? 'At least 10 characters' : undefined} autoComplete="new-password" />
        <DialogFooter>
          <Button variant="outline" className="h-11" onClick={onClose}>Cancel</Button>
          <Button className="h-11" disabled={value.length < 10 || isLoading} onClick={save}>Save password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
