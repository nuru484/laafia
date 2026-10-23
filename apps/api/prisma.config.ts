import { defineConfig } from 'prisma/config'

// The Prisma CLI does not read .env itself; load it when present (CI passes real env vars).
try {
  process.loadEnvFile('.env')
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql:///laafia?host=/var/run/postgresql',
  },
})
