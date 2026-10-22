import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, useDb } from '../helpers.ts'

useDb()

/** Every route in docs/API.md. A mounted route answers anything but the router's own "No such route" 404. */
const ROUTES: [string, string][] = [
  ['get', '/health'],
  ['post', '/auth/activate'], ['post', '/auth/refresh'],
  ['post', '/sync/push'], ['get', '/sync/pull'],
  ['get', '/content/manifest'], ['get', '/content/packs/x'], ['post', '/content/clips'], ['get', '/content/clips'], ['get', '/content/clips/x/file'],
  ['post', '/voice/transcribe'],
  ['get', '/transport/providers'], ['post', '/transport/providers'], ['patch', '/transport/providers/x'], ['post', '/transport/requests'],
  ['post', '/web/login'], ['post', '/web/logout'], ['get', '/web/me'],
  ['get', '/referrals/x/transport/options'], ['post', '/referrals/x/transport'],
  ['get', '/referrals'], ['get', '/referrals/x'], ['post', '/referrals/x/status'], ['post', '/referrals/x/onward'], ['get', '/referrals/x/client'],
  ['post', '/events/ticket'], ['get', '/events'],
  ['get', '/dashboard/overview'], ['get', '/dashboard/summary'],
  ['post', '/sms/delivery'], ['post', '/sms/inbound'], ['get', '/admin/sms/balance'], ['get', '/admin/sms/log'],
  ['get', '/admin/users'], ['post', '/admin/users'], ['post', '/admin/users/x/password'], ['post', '/admin/users/x/deactivate'], ['post', '/admin/users/x/activate'],
  ['get', '/admin/devices'], ['post', '/admin/devices'], ['post', '/admin/devices/x/code'], ['post', '/admin/devices/x/deactivate'],
  ['get', '/admin/facilities'], ['post', '/admin/facilities'], ['patch', '/admin/facilities/x'],
  ['get', '/admin/transport/providers'], ['post', '/admin/transport/providers'], ['patch', '/admin/transport/providers/x'],
  ['get', '/admin/audit'],
  ['get', '/admin/content/packs'], ['post', '/admin/content/packs'],
  ['get', '/admin/content/clips'], ['post', '/admin/content/clips'], ['get', '/admin/content/clips/matrix'], ['get', '/admin/content/clips/x/file'], ['delete', '/admin/content/clips/x'],
  ['get', '/export/dhis2'], ['post', '/export/dhis2'], ['get', '/export/dhis2/history'], ['get', '/export/dhis2/pending'],
  ['get', '/admin/import/templates'], ['post', '/admin/import/templates'], ['post', '/admin/import/preview'], ['post', '/admin/import/dhis2/preview'],
  ['get', '/admin/import/batches'], ['get', '/admin/import/batches/x'], ['post', '/admin/import/batches/x/commit'], ['post', '/admin/import/batches/x/undo'],
  ['get', '/protocols'],
]

describe('route table', () => {
  it('mounts every documented route', async () => {
    const missing: string[] = []
    for (const [method, path] of ROUTES) {
      const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[method]!(path)
      if (res.status === 404 && res.body.message === 'No such route') missing.push(`${method.toUpperCase()} ${path}`)
    }
    expect(missing).toEqual([])
  })
})
