import type { Client, ClientType, Facility, Household, Visit } from './types.ts'

/*
 * Deterministic demo catchment (spec section 19). The same call on the server
 * and on each phone yields the same ids and codes, so demos across phones agree.
 * Dates are relative to `today` so the ranked list makes sense on any demo day.
 * Coordinates are approximate, around Savelugu, Northern Region.
 */

const DAY = 86_400_000

function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type SeedDevice = { id: string; role: 'cho' | 'volunteer' | 'facility'; user_name: string; phone_number: string; facility_code: string; key_hex: string }
export type TransportProvider = { id: string; name: string; phone: string; vehicle: string; community: string }

export type Seed = {
  facilities: Facility[]
  devices: SeedDevice[]
  households: Household[]
  clients: Client[]
  visits: Visit[]
  transport_providers: TransportProvider[]
}

const COMMUNITIES = [
  { name: 'Kanshegu', lat: 9.6, lng: -0.8 },
  { name: 'Moglaa', lat: 9.655, lng: -0.87 },
  { name: 'Diare', lat: 9.68, lng: -0.76 },
]
const WOMEN = ['Amina', 'Fatima', 'Mariama', 'Zenabu', 'Ramatu', 'Abiba', 'Memunatu', 'Sana', 'Rukaya', 'Hawa', 'Ayishetu', 'Damata', 'Fuseina', 'Asana', 'Samata', 'Nafisa', 'Barikisu', 'Lamnatu', 'Wumpini', 'Napari', 'Tipaya', 'Suhuyini']
const CHILDREN = ['Wumbei', 'Tahiru', 'Nashiru', 'Fuseini', 'Mahamadu', 'Salamatu', 'Rahinatu', 'Abdul-Rahman', 'Yakubu', 'Sumaila', 'Hamdia', 'Nasara', 'Mumuni', 'Zuweira']
const SURNAMES = ['Alhassan', 'Abdulai', 'Mahama', 'Iddrisu', 'Yakubu', 'Fuseini', 'Issah', 'Mohammed', 'Sulemana', 'Osman', 'Abukari', 'Wumbei', 'Dawuda', 'Sumani', 'Zakaria']
const LANDMARKS = ['behind the mosque', 'next to the borehole', 'near the shea tree', 'opposite the grinding mill', 'beside the chief’s palace', 'near the school', 'by the dam road']
const COMPLICATIONS = ['pph', 'pre_eclampsia', 'stillbirth', 'caesarean']

/** Demo-only keys. Real devices get random keys at activation. */
const demoKey = (n: number) => n.toString(16).padStart(2, '0').repeat(32)

export function generateSeed(today: number): Seed {
  const rand = prng(20261022)
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
  const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, '0')}`

  const facilities: Facility[] = [
    { id: 'fac-0001', code: 'SAV-CHPS-01', name: 'Kanshegu CHPS', level: 'chps', phone: '0200000001', lat: 9.603, lng: -0.805, capabilities: [] },
    { id: 'fac-0002', code: 'PTA-HC-01', name: 'Pong-Tamale Health Centre', level: 'health_centre', phone: '0200000002', lat: 9.68, lng: -0.83, capabilities: ['bemonc'] },
    { id: 'fac-0003', code: 'SAV-HOSP-01', name: 'Savelugu Municipal Hospital', level: 'hospital', phone: '0200000003', lat: 9.624, lng: -0.825, capabilities: ['bemonc', 'cemonc'] },
    { id: 'fac-0004', code: 'TTH-HOSP-01', name: 'Tamale Teaching Hospital', level: 'hospital', phone: '0200000004', lat: 9.42, lng: -0.84, capabilities: ['bemonc', 'cemonc', 'theatre', 'nicu'] },
    // No seeded catchment: the demo imports its register from the dashboard.
    { id: 'fac-0005', code: 'SAV-CHPS-02', name: 'Nabogu CHPS', level: 'chps', phone: '0200000005', lat: 9.7447, lng: -0.8233, capabilities: [] },
  ]

  const devices: SeedDevice[] = [
    { id: 'D001', role: 'cho', user_name: 'Abiba Sulemana', phone_number: '0240000001', facility_code: 'SAV-CHPS-01', key_hex: demoKey(1) },
    { id: 'V001', role: 'volunteer', user_name: 'Iddrisu Mahama', phone_number: '0240000002', facility_code: 'SAV-CHPS-01', key_hex: demoKey(2) },
    { id: 'F001', role: 'facility', user_name: 'Kanshegu CHPS', phone_number: '0200000001', facility_code: 'SAV-CHPS-01', key_hex: demoKey(3) },
    { id: 'F002', role: 'facility', user_name: 'Pong-Tamale HC', phone_number: '0200000002', facility_code: 'PTA-HC-01', key_hex: demoKey(4) },
    { id: 'F003', role: 'facility', user_name: 'Savelugu Hospital', phone_number: '0200000003', facility_code: 'SAV-HOSP-01', key_hex: demoKey(5) },
    { id: 'D002', role: 'cho', user_name: 'Mariama Abdulai', phone_number: '0240000003', facility_code: 'SAV-CHPS-02', key_hex: demoKey(6) },
  ]

  const households: Household[] = []
  const clients: Client[] = []
  const visits: Visit[] = []
  let clientNo = 0
  let visitNo = 0

  const addClient = (hh: Household, type: ClientType, over: Partial<Client>): Client => {
    clientNo += 1
    const c: Client = {
      id: id('cl', clientNo), household_id: hh.id, code: `CL-${String(clientNo).padStart(4, '0')}`, type,
      name: '', sex: 'f', dob: null, edd: null, delivery_date: null, parity: null, prior_complications: [],
      birth_weight_g: null, nhis_active: rand() > 0.2, ...over,
    }
    clients.push(c)
    return c
  }
  const addVisit = (c: Client, daysAgo: number, over: Partial<Visit> = {}) => {
    visitNo += 1
    const protocol_id = c.type === 'pregnant' || c.type === 'postpartum' ? 'maternal' : c.type === 'newborn' ? 'young_infant' : 'child'
    visits.push({ id: id('vi', visitNo), client_id: c.id, protocol_id, visited_at: today - daysAgo * DAY, answers: {}, outcome: 'routine', rule_id: 'DEFAULT', followup_due: null, muac_mm: null, ...over })
  }

  for (let h = 1; h <= 40; h++) {
    const com = COMMUNITIES[(h - 1) % 3]!
    const surname = pick(SURNAMES)
    const hh: Household = {
      id: id('hh', h), community: com.name, head_name: `${pick(['Alhaji', 'Mba', 'Naa'])} ${surname}`, landmark: `${surname} house, ${pick(LANDMARKS)}, ${com.name}`,
      lat: h % 13 === 0 ? null : +(com.lat + (rand() - 0.5) * 0.02).toFixed(5), lng: h % 13 === 0 ? null : +(com.lng + (rand() - 0.5) * 0.02).toFixed(5),
      consent_at: today - 120 * DAY,
    }
    households.push(hh)
    const mother = `${pick(WOMEN)} ${surname}`
    const kind = h % 4

    if (kind === 0) {
      // pregnant, ANC history of varying completeness
      const ga = 10 + Math.floor(rand() * 28)
      const parity = Math.floor(rand() * 5)
      const c = addClient(hh, 'pregnant', { name: mother, edd: today + (280 - ga * 7) * DAY, parity, prior_complications: parity > 0 && rand() > 0.6 ? [pick(COMPLICATIONS)] : [] })
      const contacts = Math.floor(rand() * 3)
      for (let i = 0; i < contacts; i++) addVisit(c, 20 + i * 30)
    } else if (kind === 1 && h < 30) {
      // recently delivered mother and newborn
      const dpp = Math.floor(rand() * 30)
      const m = addClient(hh, 'postpartum', { name: mother, delivery_date: today - dpp * DAY, parity: 1 + Math.floor(rand() * 4), prior_complications: rand() > 0.7 ? [pick(COMPLICATIONS)] : [] })
      const nb = addClient(hh, 'newborn', { name: `Baby of ${mother}`, sex: rand() > 0.5 ? 'f' : 'm', dob: today - dpp * DAY, birth_weight_g: 2100 + Math.floor(rand() * 1500) })
      if (dpp > 3 && rand() > 0.4) {
        addVisit(m, Math.floor(dpp / 2))
        addVisit(nb, Math.floor(dpp / 2))
      }
    } else {
      // under-five, some with a MUAC history and follow-ups
      const age = 6 + Math.floor(rand() * 50)
      const c = addClient(hh, 'child', { name: `${pick(CHILDREN)} ${surname}`, sex: rand() > 0.5 ? 'f' : 'm', dob: today - age * 30 * DAY, birth_weight_g: 2300 + Math.floor(rand() * 1400) })
      const muac = 108 + Math.floor(rand() * 40)
      addVisit(c, 5 + Math.floor(rand() * 40), { muac_mm: muac, outcome: muac < 125 ? 'followup' : 'routine', followup_due: muac < 125 ? today - Math.floor(rand() * 5) * DAY : null })
    }
  }

  // Showcase cases the demo walks through, always at the top of the list.
  const demoHh = households[1]!
  const amina = addClient(demoHh, 'postpartum', { name: `Amina ${demoHh.head_name.split(' ').pop()}`, delivery_date: today - DAY, parity: 2, prior_complications: ['pph'] })
  addClient(demoHh, 'newborn', { name: `Baby of ${amina.name}`, sex: 'm', dob: today - DAY, birth_weight_g: 2300 })

  const transport_providers: TransportProvider[] = [
    { id: 'tp-0001', name: 'Fuseini Abukari', phone: '0240000101', vehicle: 'motor king tricycle', community: 'Kanshegu' },
    { id: 'tp-0002', name: 'Moglaa community ambulance', phone: '0240000102', vehicle: 'ambulance', community: 'Moglaa' },
  ]

  return { facilities, devices, households, clients, visits, transport_providers }
}
