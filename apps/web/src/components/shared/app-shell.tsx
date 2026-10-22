'use client'

import { LogOut, Menu } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { NAV, ROLE_LABEL } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useLogoutMutation } from '@/redux/endpoints'
import type { User } from '@/types/api'

function NavLinks({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const path = usePathname()
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.filter((n) => n.roles.includes(user.role)).map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3">
      <span className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden>L</span>
      <span className="text-base font-semibold">Laafia</span>
    </div>
  )
}

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [logout, { isLoading }] = useLogoutMutation()
  const router = useRouter()
  const scope = user.facility?.name ?? user.district?.name ?? ''

  async function signOut() {
    await logout().unwrap().catch(() => undefined)
    router.replace('/login')
  }

  const account = (
    <div className="flex flex-col gap-2 border-t px-3 pt-3">
      <div className="min-w-0">
        <p className="line-clamp-1 text-sm font-medium [overflow-wrap:anywhere]">{user.name}</p>
        <p className="line-clamp-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{ROLE_LABEL[user.role]}{scope ? ` · ${scope}` : ''}</p>
      </div>
      <Button variant="outline" size="sm" onClick={signOut} disabled={isLoading} className="justify-start">
        <LogOut className="size-4" aria-hidden /> Sign out
      </Button>
    </div>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar py-4 lg:flex">
        <Brand />
        <div className="flex-1 overflow-y-auto px-2"><NavLinks user={user} /></div>
        {account}
      </aside>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="size-5" /></Button>
        <Brand />
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-4 py-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Brand />
          <div className="flex-1 overflow-y-auto px-2"><NavLinks user={user} onNavigate={() => setOpen(false)} /></div>
          {account}
        </SheetContent>
      </Sheet>
      <main className="@container/main min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
