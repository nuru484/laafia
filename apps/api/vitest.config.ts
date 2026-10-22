import { defineConfig } from 'vitest/config'
import { TEST_DATABASE_URL } from './src/platform/testing/test-db.ts'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    fileParallelism: false,
    globalSetup: ['./src/platform/testing/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: TEST_DATABASE_URL,
      ADMIN_TOKEN: 'test-admin-token',
      ARKESEL_API_KEY: '',
    },
  },
})
