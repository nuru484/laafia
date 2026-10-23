'use client'

import { BookOpen, Building2, ClipboardList, KeyRound, MessageSquareText, Smartphone, Users, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/shared/page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ROLE_LABEL } from '@/lib/nav'
import { useMeQuery } from '@/redux/endpoints'
import type { Role } from '@/types/api'

type Section = { icon: LucideIcon; title: string; steps: string[] }

const GUIDE: Record<Role, Section[]> = {
  district_admin: [
    { icon: Building2, title: 'Set up the facilities', steps: [
      'Facilities, Add facility: the code, name, level and its position. The checklist chooses destinations by level and by what each can treat.',
      'Give each facility its referral phone: activating a facility phone there sets it for you.',
    ] },
    { icon: Smartphone, title: 'Give out the phones', steps: [
      'Phones, Nurses, Add nurse: choose her facility and share the 8-digit code. She enters it on her phone, with internet, with her own number.',
      'Phones, Facility phones: add one for each health centre and hospital. That phone rings for every referral sent there and texts back each step.',
      'Lost or replaced phone: Actions, Replace phone for a new code, or Deactivate; it wipes itself on its next sync.',
    ] },
    { icon: Users, title: 'Give people access', steps: [
      'Users, Add user: supervisors see the district read only; facility staff see the referrals for their facility.',
      'Share the first password in person. Each user can change it under their profile.',
    ] },
    { icon: ClipboardList, title: 'Watch the referrals', steps: [
      'Overview shows referrals with no acknowledgement and clients who did not arrive. Call the facility or the CHO.',
      'Referrals lists every referral; search by client code, danger sign or facility, and open one for its timeline.',
    ] },
    { icon: MessageSquareText, title: 'Keep the texts flowing', steps: [
      'SMS gateway shows the server\'s SMS credit. Top it up before it runs out, or facilities cannot be told about web acknowledgements.',
      'Audit log records every change made on the dashboard, by whom and when.',
    ] },
  ],
  supervisor: [
    { icon: ClipboardList, title: 'Follow the district', steps: [
      'Overview shows how many referrals were made, how fast facilities acknowledged them and how many were completed, for the last 7, 30 or 90 days.',
      'The lists of unacknowledged referrals and clients who did not arrive are where follow-up calls are needed.',
      'Referrals: search and filter every referral, and open one for its full timeline.',
    ] },
    { icon: BookOpen, title: 'Review the checklists', steps: [
      'Checklists shows each WHO-based checklist exactly as the phones run it: the questions, which answer leads to which question, and every rule.',
    ] },
  ],
  facility_staff: [
    { icon: ClipboardList, title: 'Incoming referrals', steps: [
      'Referrals shows those sent to your facility, live, most urgent first. Open one to see the danger signs and who sent it.',
      'Acknowledge it, then Mark arrived, Mark treated and Discharge and close as she moves through. Each step texts the CHO.',
      'If she needs a higher level, Refer onward sends the same assessment there.',
    ] },
    { icon: Smartphone, title: 'The facility phone', steps: [
      'The facility phone rings for referrals even when the app is closed, and does the same steps. Use whichever is at hand; both stay in step.',
    ] },
  ],
}

const ALL: Section = { icon: KeyRound, title: 'Your account', steps: [
  'Open your name at the bottom of the menu, then View profile, to change your name, email, phone or password.',
  'Sign out from the same menu when you leave a shared computer.',
] }

/** How to use the dashboard, for each role; opens on the reader's own. */
export default function GuidePage() {
  const { data } = useMeQuery()
  const role = data!.user.role
  const roles: Role[] = role === 'district_admin' ? ['district_admin', 'supervisor', 'facility_staff'] : [role]
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Guide" description="How to use Laafia, step by step. The phones have their own guide under More, How to use Laafia." />
      <Tabs defaultValue={role}>
        {roles.length > 1 ? (
          <TabsList className="mb-4 grid w-full grid-cols-1 gap-1 group-data-horizontal/tabs:h-auto sm:flex sm:w-fit">
            {roles.map((r) => <TabsTrigger key={r} value={r} className="h-10 justify-start px-3 sm:justify-center">{ROLE_LABEL[r]}</TabsTrigger>)}
          </TabsList>
        ) : null}
        {roles.map((r) => (
          <TabsContent key={r} value={r} className="flex flex-col gap-4">
            {[...GUIDE[r], ALL].map((sec) => (
              <section key={sec.title} className="-mx-4 border-y bg-card px-4 py-5 sm:mx-0 sm:rounded-lg sm:border sm:px-6" aria-labelledby={`${r}-${sec.title}`}>
                <div className="mb-3 flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center bg-primary/10 text-primary" aria-hidden><sec.icon className="size-4" /></span>
                  <h2 id={`${r}-${sec.title}`} className="text-base font-semibold">{sec.title}</h2>
                </div>
                <ol className="flex flex-col gap-2.5 text-sm leading-relaxed">
                  {sec.steps.map((s, i) => (
                    <li key={i} className="flex gap-3"><span className="w-4 shrink-0 font-semibold text-muted-foreground tabular-nums">{i + 1}</span><span className="min-w-0">{s}</span></li>
                  ))}
                </ol>
              </section>
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
