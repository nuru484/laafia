import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql:///laafia_test?host=/var/run/postgresql',
      ADMIN_TOKEN: 'test-admin-token',
      ARKESEL_API_KEY: '',
    },
  },
})
