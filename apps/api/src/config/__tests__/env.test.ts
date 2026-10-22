import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('environment', () => {
  it('refuses to boot in production without its secrets', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "await import('./src/config/env.ts')"], {
      cwd: new URL('../../..', import.meta.url).pathname, env: { PATH: process.env.PATH, NODE_ENV: 'production' }, encoding: 'utf8',
    })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('JWT_SECRET')
    expect(r.stderr).toContain('SMS_WEBHOOK_TOKEN')
    expect(r.stderr).toContain('DATABASE_URL')
  })
})
