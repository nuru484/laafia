import type { Role } from '@/types/api'
import { Activity, BookCheck, Building2, ClipboardList, History, MessageSquareText, Stethoscope, Users, type LucideIcon } from 'lucide-react'

export type NavItem = { href: string; label: string; icon: LucideIcon; roles: Role[] }

export const NAV: NavItem[] = [
  { href: '/', label: 'Overview', icon: Activity, roles: ['district_admin', 'supervisor'] },
  { href: '/referrals', label: 'Referrals', icon: ClipboardList, roles: ['district_admin', 'supervisor', 'facility_staff'] },
  { href: '/users', label: 'Users', icon: Users, roles: ['district_admin'] },
  { href: '/nurses', label: 'Nurses', icon: Stethoscope, roles: ['district_admin'] },
  { href: '/facilities', label: 'Facilities', icon: Building2, roles: ['district_admin'] },
  { href: '/checklists', label: 'Checklists', icon: BookCheck, roles: ['district_admin', 'supervisor', 'facility_staff'] },
  { href: '/sms', label: 'SMS gateway', icon: MessageSquareText, roles: ['district_admin'] },
  { href: '/audit', label: 'Audit log', icon: History, roles: ['district_admin'] },
]

export const homeFor = (role: Role) => (role === 'facility_staff' ? '/referrals' : '/')
export const ROLE_LABEL: Record<Role, string> = { district_admin: 'District admin', supervisor: 'Supervisor', facility_staff: 'Facility staff' }
