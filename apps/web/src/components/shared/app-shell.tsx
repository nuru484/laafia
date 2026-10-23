'use client'

import { ChevronDown, ChevronsUpDown, LogOut, Menu, UserRound } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Brand } from '@/components/shared/brand'
import { useConfirm } from '@/components/shared/confirm'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { NAV, ROLE_LABEL, type NavItem, type NavLink } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { useLogoutMutation } from '@/redux/endpoints'
import type { User } from '@/types/api'

const linkCls = (active: boolean) => cn(
  'flex min-h-11 items-center gap-3 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
  active && 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary',
)

function NavLinks({ user, onNavigate }: { user: User; onNavigate?: () => void }) {
  const path = usePathname()
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href))
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.filter((n) => n.roles.includes(user.role)).map((item) =>
        'children' in item ? <NavGroup key={item.label} item={item} isActive={isActive} onNavigate={onNavigate} /> : (
          <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={isActive(item.href) ? 'page' : undefined} className={linkCls(isActive(item.href))}>
            <item.icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        ))}
    </nav>
  )
}

/** A sidebar group that opens and closes; it starts open when one of its pages is showing. */
function NavGroup({ item, isActive, onNavigate }: { item: Extract<NavItem, { children: NavLink[] }>; isActive: (href: string) => boolean; onNavigate?: () => void }) {
  const here = item.children.some((c) => isActive(c.href))
  const [open, setOpen] = useState(here)
  const id = `nav-${item.label.toLowerCase()}`
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open || here} aria-controls={id} className={cn(linkCls(false), 'w-full', here && 'text-foreground')}>
        <item.icon className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 text-left">{item.label}</span>
        <ChevronDown className={cn('size-4 shrink-0 transition-transform', (open || here) && 'rotate-180')} aria-hidden />
      </button>
      {open || here ? (
        <div id={id} className="ml-5 flex flex-col gap-0.5 border-l pl-2">
          {item.children.map((c) => (
            <Link key={c.href} href={c.href} onClick={onNavigate} aria-current={isActive(c.href) ? 'page' : undefined} className={linkCls(isActive(c.href))}>
              <c.icon className="size-4 shrink-0" aria-hidden />
              {c.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Logo() {
  return <Link href="/" aria-label="Laafia, overview" className="w-fit px-3"><Brand /></Link>
}

export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [logout, { isLoading }] = useLogoutMutation()
  const [confirm, confirmDialog] = useConfirm()
  const path = usePathname()
  const router = useRouter()

  async function signOut() {
    if (!(await confirm({ title: 'Sign out?', body: 'You will need your email or phone and password to sign in again.', confirm: 'Sign out' }))) return
    await logout().unwrap().catch(() => undefined)
    router.replace('/login')
  }

  const initials = user.name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  // One control for the account: it opens upwards with the profile and signing out, so neither is a stray button.
  const account = (
    <div className="border-t px-2 pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Account menu for ${user.name}`}
          className={cn('flex min-h-12 w-full min-w-0 items-center gap-3 px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-muted', path === '/profile' && 'bg-primary/10')}>
          <span className="grid size-9 shrink-0 place-items-center bg-primary/10 text-sm font-semibold text-primary" aria-hidden>{initials}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium" title={user.name}>{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-(--anchor-width) min-w-52">
          <DropdownMenuItem className="min-h-10 px-2.5" onClick={() => { setOpen(false); router.push('/profile') }}>
            <UserRound aria-hidden /> View profile
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-10 px-2.5" variant="destructive" disabled={isLoading} onClick={() => void signOut()}>
            <LogOut aria-hidden /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-4 border-r bg-sidebar py-4 lg:flex">
        <Logo />
        <div className="flex-1 overflow-y-auto px-2"><NavLinks user={user} /></div>
        {account}
      </aside>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setOpen(true)}><Menu className="size-5" /></Button>
        <Logo />
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="flex w-72 flex-col gap-4 py-4">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Logo />
          <div className="flex-1 overflow-y-auto px-2"><NavLinks user={user} onNavigate={() => setOpen(false)} /></div>
          {account}
        </SheetContent>
      </Sheet>
      <main className="@container/main min-w-0 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      {confirmDialog}
    </div>
  )
}
