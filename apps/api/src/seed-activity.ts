import { shortIdFromBytes, type ReferralStatus } from '@laafia/core'
import { write, type Tx } from './platform/db.ts'
import type { Deps } from './platform/deps.ts'

/*
 * Demo activity on top of the catchment seed, so every dashboard screen has real content:
 * referrals across the last two weeks in every state (including overdue acknowledgements and
 * patients who did not arrive), an onward chain, device sync times,
 * server SMS with delivery receipts and audit rows. Re-running replaces it.
 * Not used by the tests, which start from the bare catchment.
 */

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Step = [ReferralStatus, number] // status, minutes after the referral was made
type Demo = {
  n: number; type: string; context: string; urgency: 1 | 2 | 3; signs: string[]; dest: string; agoMin: number; steps: Step[]
  origin?: string; parent?: number
}

const FULL: Step[] = [['sent', 1], ['received', 9], ['arrived', 95], ['treated', 160], ['closed', 1500]]

const DEMOS: Demo[] = [
  { n: 1, type: 'postpartum', context: 'PP1', urgency: 3, signs: ['bleeding'], dest: 'fac-0003', agoMin: 50, steps: [['sent', 1], ['received', 6]] },
  { n: 2, type: 'newborn', context: 'NB1', urgency: 3, signs: ['not_feeding', 'hypothermia'], dest: 'fac-0003', agoMin: 35, steps: [['sent', 1]] },
  { n: 3, type: 'pregnant', context: 'GA34', urgency: 2, signs: ['headache_vision', 'swelling'], dest: 'fac-0002', agoMin: 140, steps: [['sent', 2]] },
  { n: 4, type: 'child', context: 'AGE14M', urgency: 2, signs: ['chest_indrawing'], dest: 'fac-0002', agoMin: 7 * HOUR / MIN, steps: [['sent', 1], ['received', 22], ['arrived', 150]] },
  { n: 5, type: 'child', context: 'AGE30M', urgency: 3, signs: ['convulsions'], dest: 'fac-0003', agoMin: 30 * HOUR / MIN, steps: [['sent', 1], ['received', 4]] },
  { n: 6, type: 'pregnant', context: 'GA38', urgency: 2, signs: ['waters'], dest: 'fac-0003', agoMin: 3 * DAY / MIN, steps: FULL },
  { n: 7, type: 'postpartum', context: 'PP5', urgency: 1, signs: ['discharge'], dest: 'fac-0002', agoMin: 4 * DAY / MIN, steps: FULL.slice(0, 4) },
  { n: 8, type: 'child', context: 'AGE9M', urgency: 1, signs: ['long_diarrhoea'], dest: 'fac-0002', agoMin: 5 * DAY / MIN, steps: [['sent', 3], ['received', 70], ['arrived', 400], ['treated', 480], ['closed', 2000]] },
  { n: 9, type: 'newborn', context: 'NB4', urgency: 3, signs: ['fast_breathing'], dest: 'fac-0002', agoMin: 6 * DAY / MIN, steps: [['sent', 1], ['received', 12], ['arrived', 80]] },
  { n: 10, type: 'newborn', context: 'NB4', urgency: 3, signs: ['fast_breathing'], dest: 'fac-0003', agoMin: 6 * DAY / MIN - 200, steps: [['sent', 1], ['received', 15], ['arrived', 70], ['treated', 130], ['closed', 4000]], origin: 'F002', parent: 9 },
  { n: 11, type: 'pregnant', context: 'GA28', urgency: 2, signs: ['fever_weak'], dest: 'fac-0004', agoMin: 8 * DAY / MIN, steps: FULL },
  { n: 12, type: 'child', context: 'AGE40M', urgency: 2, signs: ['muac_red', 'oedema'], dest: 'fac-0003', agoMin: 10 * DAY / MIN, steps: [['sent', 2], ['received', 30], ['cancelled', 200]] },
  { n: 13, type: 'postpartum', context: 'PP2', urgency: 3, signs: ['abdominal_pain'], dest: 'fac-0003', agoMin: 12 * DAY / MIN, steps: FULL },
  { n: 14, type: 'child', context: 'AGE20M', urgency: 1, signs: ['long_fever'], dest: 'fac-0002', agoMin: 13 * DAY / MIN, steps: [['sent', 4], ['received', 120], ['arrived', 1400], ['treated', 1500], ['closed', 3000]] },
]

const source = (status: ReferralStatus, origin: string, dest: string) =>
  status === 'sent' || status === 'cancelled' ? origin : dest === 'fac-0003' ? 'F003' : dest === 'fac-0002' ? 'F002' : 'GW01'

async function clear(tx: Tx) {
  await tx.referral.deleteMany({ where: { id: { startsWith: 'demo-' } } }) // events cascade
  await tx.job.deleteMany({ where: { dedupeKey: { startsWith: 'demo:' } } })
  await tx.auditEvent.deleteMany({ where: { id: { startsWith: 'demo-' } } })
}

export async function seedActivity(deps: Deps, now = Date.now()) {
  await write(deps.prisma, async (tx) => {
    await clear(tx)
    // Real seeded clients of the right type, so a referral's client lookup and the CHO phone agree.
    const clients = await tx.client.findMany({ where: { facilityId: 'fac-0001' }, orderBy: { code: 'desc' }, select: { id: true, code: true, type: true } })
    const used = new Map<string, number>()
    const pick = (type: string, n: number) => {
      const of = clients.filter((c) => c.type === type)
      const k = n === 10 ? (used.get(type) ?? 1) - 1 : (used.get(type) ?? 0) // the onward referral keeps its parent's client
      used.set(type, n === 10 ? k + 1 : k + 1)
      return of[k % of.length]!
    }
    for (const d of DEMOS) {
      const c = pick(d.type, d.n)
      const made = now - d.agoMin * MIN
      const origin = d.origin ?? 'D001'
      const id = `demo-r${String(d.n).padStart(2, '0')}`
      const status = d.steps.reduce<ReferralStatus>((s, [st]) => (st === 'cancelled' ? 'cancelled' : st), 'created')
      await tx.referral.create({
        data: {
          id, originDeviceId: origin, shortId: shortIdFromBytes(new Uint8Array([0xa0, d.n, 7, 21, 99])), facilityId: origin === 'D001' ? 'fac-0001' : 'fac-0002',
          clientId: c.id, clientCode: c.code, clientType: d.type, context: d.context, urgency: d.urgency, dangerSigns: d.signs, destinationFacilityId: d.dest,
          nextOfKin: '0241234567', deliveredVia: d.n % 3 === 0 ? 'https' : 'sms', status, updatedAt: made + (d.steps.at(-1)?.[1] ?? 0) * MIN, deviceId: origin,
          parentReferralId: d.parent ? `demo-r${String(d.parent).padStart(2, '0')}` : null,
        },
      })
      await tx.referralEvent.createMany({
        data: d.steps.map(([st, m], i) => ({
          id: `${id}-e${i}`, referralId: id, status: st, at: made + m * MIN, sourceDeviceId: source(st, origin, d.dest), via: i % 2 ? 'sms' : 'https', updatedAt: made + m * MIN, deviceId: source(st, origin, d.dest),
        })),
      })
    }
    // Onward chain: r09 (Pong-Tamale) continued as r10 (Savelugu Hospital).
    await tx.referral.update({ where: { id: 'demo-r09' }, data: { onwardReferralId: 'demo-r10', onwardStatus: 'closed' } })

    // Last sync per device: D002 has not synced for five days.
    const sync = (deviceId: string, ago: number, appVersion: string) => ({ deviceId, lastSyncAt: now - ago, appVersion })
    for (const s of [sync('D001', 12 * MIN, '0.4.2'), sync('D002', 5 * DAY, '0.4.0'), sync('F001', 2 * HOUR, '0.4.2'), sync('F002', 40 * MIN, '0.4.2'), sync('F003', 6 * MIN, '0.4.2')]) {
      await tx.deviceStatus.upsert({ where: { deviceId: s.deviceId }, create: s, update: s })
    }

    // Server-sent SMS with Frog delivery receipts. Bodies are LFS/LFT wire text with codes, never names.
    const job = (n: number, to: string, body: string, ago: number, delivery: string | null, status = 'sent') => ({
      kind: 'sms', payload: { to, body }, status, attempts: status === 'pending' ? 0 : 1, runAt: now - ago, createdAt: now - ago, dedupeKey: `demo:${n}`,
      purpose: 'status', districtId: 'dist-sav',
      deliveryStatus: delivery, deliveryReason: delivery === 'failed' ? 'Absent subscriber' : delivery === 'delivered' ? 'Delivered' : null, deliveredAt: delivery === 'delivered' ? now - ago + 20_000 : null,
    })
    await tx.job.createMany({
      data: [
        job(1, '0240000001', 'LFS|1|F003|D001|UAIAOFOD|R|DEMOSIGN', 44 * MIN, 'delivered'),
        job(3, '0240000001', 'LFS|1|F002|D001|UAIQOFOD|A|DEMOSIGN', 4 * HOUR, 'delivered'),
        job(4, '0240000001', 'LFS|1|F003|D001|UAJAOFOD|R|DEMOSIGN', 29 * HOUR, 'failed'),
        job(5, '0240000001', 'LFS|1|GW01|D001|UALAOFOD|T|DEMOSIGN', 2 * DAY, 'delivered'),
        job(6, '0240000001', 'LFS|1|F003|D001|UAJQOFOD|C|DEMOSIGN', 5 * MIN, null, 'pending'),
      ],
    })

    const audit = (n: number, ago: number, action: string, targetType: string, targetId: string, details: object) => ({
      id: `demo-a${n}`, at: now - ago, actorKind: 'user', actorId: 'usr-0001', actorName: 'Nurudeen Abdul-Majeed', action, targetType, targetId, districtId: 'dist-sav', details,
    })
    await tx.auditEvent.createMany({
      data: [
        audit(2, 6 * DAY, 'device.code_reissue', 'device', 'D002', {}),
        audit(3, 3 * DAY, 'facility.update', 'facility', 'fac-0002', { fields: ['phone'] }),
        audit(4, 26 * HOUR, 'user.create', 'user', 'usr-0003', { role: 'facility_staff' }),
      ],
    })
  })
  return { referrals: DEMOS.length }
}
