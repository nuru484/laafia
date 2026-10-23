import type { Role } from '@/types/api'
import { Activity, BookCheck, BookOpen, CopyCheck, Building2, ClipboardList, History, Hospital, MessageSquareText, Smartphone, Stethoscope, Users, type LucideIcon } from 'lucide-react'

export type NavLink = { href: string; label: string; icon: LucideIcon }
/** A link, or a group (`children`) that opens and closes in the sidebar. */
export type NavItem = (NavLink | { label: string; icon: LucideIcon; children: NavLink[] }) & { roles: Role[] }

export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: Activity, roles: ['district_admin', 'supervisor'] },
  { href: '/referrals', label: 'Referrals', icon: ClipboardList, roles: ['district_admin', 'supervisor', 'facility_staff'] },
  { href: '/users', label: 'Users', icon: Users, roles: ['district_admin'] },
  {
    label: 'Phones', icon: Smartphone, roles: ['district_admin'],
    children: [{ href: '/nurses', label: 'Nurses', icon: Stethoscope }, { href: '/facility-phones', label: 'Facility phones', icon: Hospital }],
  },
  { href: '/facilities', label: 'Facilities', icon: Building2, roles: ['district_admin'] },
  { href: '/duplicates', label: 'Possible duplicates', icon: CopyCheck, roles: ['district_admin'] },
  { href: '/checklists', label: 'Checklists', icon: BookCheck, roles: ['district_admin', 'supervisor', 'facility_staff'] },
  { href: '/sms', label: 'SMS gateway', icon: MessageSquareText, roles: ['district_admin'] },
  { href: '/audit', label: 'Audit log', icon: History, roles: ['district_admin'] },
  { href: '/guide', label: 'Guide', icon: BookOpen, roles: ['district_admin', 'supervisor', 'facility_staff'] },
]

export const homeFor = (role: Role) => (role === 'facility_staff' ? '/referrals' : '/')
export const ROLE_LABEL: Record<Role, string> = { district_admin: 'District admin', supervisor: 'Supervisor', facility_staff: 'Facility staff' }
