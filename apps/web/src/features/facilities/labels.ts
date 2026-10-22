import type { Facility } from '@/types/api'

export const LEVEL: Record<Facility['level'], string> = { chps: 'CHPS compound', health_centre: 'Health centre', hospital: 'Hospital' }

/** CHPS compounds first, then health centres, then hospitals; by name within a level. */
export const byLevel = (a: Pick<Facility, 'level' | 'name'>, b: Pick<Facility, 'level' | 'name'>) =>
  Object.keys(LEVEL).indexOf(a.level) - Object.keys(LEVEL).indexOf(b.level) || a.name.localeCompare(b.name)
