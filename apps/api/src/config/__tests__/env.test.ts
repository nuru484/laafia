import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { trustProxy } from '../env.ts'

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

  it('reads TRUST_PROXY as a hop count, a boolean, or addresses', () => {
    expect(trustProxy('1')).toBe(1)
    expect(trustProxy('true')).toBe(true)
    expect(trustProxy('loopback')).toBe('loopback')
    expect(trustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8')
  })
})
