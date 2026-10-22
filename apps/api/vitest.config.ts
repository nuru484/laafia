import { existsSync, readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// TEST_DATABASE_URL in .env keeps each checkout on its own test database. Only that variable is read:
// the rest of .env is runtime configuration the tests set for themselves.
const fromEnvFile = existsSync('.env') ? /^TEST_DATABASE_URL=(.+)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim() : undefined
if (fromEnvFile && !process.env.TEST_DATABASE_URL) process.env.TEST_DATABASE_URL = fromEnvFile
const { TEST_DATABASE_URL } = await import('./src/platform/testing/test-db.ts')

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['./src/platform/testing/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      ADMIN_TOKEN: 'test-admin-token',
      FROG_API_KEY: '',
    },
  },
})
