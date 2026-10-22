import { generateSeed, shortIdFromBytes, type ReferralMessage } from '@laafia/core'
import request from 'supertest'
import { afterAll, beforeEach, expect } from 'vitest'
import { createApp } from '../../app.ts'
import { resetActivationLimits } from '../../modules/auth/index.ts'
import { DEMO_CODES, seedDemo } from '../../seed.ts'
import { buildDeps } from '../deps.ts'
import type { Logger } from '../logger.ts'

const quiet: Logger = { info() {}, warn() {}, error() {} }
export const deps = buildDeps({ logger: quiet })
export const prisma = deps.prisma
export const app = createApp(deps)
export const TODAY = Date.UTC(2026, 9, 22)
export const KEYS = Object.fromEntries(generateSeed(TODAY).devices.map((d) => [d.id, d.key_hex]))
export const ADMIN = { 'x-admin-token': 'test-admin-token' }

/** Empty database, seeded, before every test in the file. Children before parents (foreign keys). */
export function useDb() {
  beforeEach(async () => {
    await prisma.referralEvent.deleteMany()
    await prisma.referral.deleteMany()
    await prisma.activationCode.deleteMany()
    await prisma.importBatch.deleteMany()
    await prisma.mappingTemplate.deleteMany()
    await prisma.contentPack.deleteMany()
    await prisma.contentClip.deleteMany()
    await prisma.job.deleteMany()
    await prisma.transportRequest.deleteMany()
    await prisma.transportProvider.deleteMany()
    await prisma.visit.deleteMany()
    await prisma.client.deleteMany()
    await prisma.household.deleteMany()
    await prisma.device.deleteMany()
    await prisma.facility.deleteMany()
    await prisma.district.deleteMany()
    await seedDemo(deps, TODAY)
    resetActivationLimits()
  })
  afterAll(() => prisma.$disconnect())
}

export async function activate(deviceId: string, phone = '0240000001') {
  const res = await request(app).post('/auth/activate').send({ activation_code: DEMO_CODES[deviceId], phone_number: phone })
  expect(res.status).toBe(200)
  return res.body.jwt as string
}
export const bearer = (jwt: string) => ({ Authorization: `Bearer ${jwt}` })
export const pushAs = (jwt: string, records: { table: string; row: Record<string, unknown> }[]) =>
  request(app).post('/sync/push').set(bearer(jwt)).send({ records })
export const pullAs = (jwt: string, since = '', limit = 500) =>
  request(app).get(`/sync/pull?since=${since}&limit=${limit}`).set(bearer(jwt))

export const household = (over: Record<string, unknown> = {}) => ({
  id: 'hh-new-1', updated_at: 1_000, community: 'Kanshegu', head_name: 'Mba Test', landmark: 'by the borehole', lat: 9.6, lng: -0.8, consent_at: 1_000, ...over,
})
export const SID = shortIdFromBytes(new Uint8Array([9, 8, 7, 6, 5]))
export const lfr: ReferralMessage = {
  kind: 'LFR', signer: 'D001', short_id: SID, client_code: 'CL-0041', urgency: 3, client_type: 'PP', context: 'PP1',
  sign_codes: ['bl'], destination: 'SAV-HOSP-01', next_of_kin: '0241234567',
}
export const sms = (body: string, from = '+233240000001') => request(app).post('/sms/inbound').send({ from, text: body })
export const event = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(), updated_at: TODAY, referral_id: 'r-uuid-1', origin_device_id: 'D001', short_id: SID,
  status: 'sent', at: TODAY, source_device_id: 'D001', via: 'local', ...over,
})
