import { z } from 'zod'

/*
 * All configuration, validated once at boot. Fails fast with every problem
 * listed. Secrets live only in apps/api/.env (gitignored); every variable is
 * documented in .env.example.
 */

// Empty values in .env count as unset.
const blank = <T extends z.ZodType>(t: T) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), t)
const optional = blank(z.string().optional())
const isProd = process.env.NODE_ENV === 'production'
const requiredInProd = (min = 1) =>
  blank(isProd ? z.string({ error: `required in production` }).min(min, `must be at least ${min} chars`) : z.string().optional())

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Socket example: postgresql://<os-user>@localhost/laafia?host=/var/run/postgresql
  DATABASE_URL: z.string({ error: 'required' }).min(1),
  JWT_SECRET: requiredInProd(32),
  ADMIN_TOKEN: requiredInProd(24),
  SMS_WEBHOOK_TOKEN: requiredInProd(24),
  WEB_ORIGIN: optional,
  TRUST_PROXY: z.string().default('loopback'),
  FROG_API_KEY: optional,
  FROG_USERNAME: optional,
  FROG_SENDER_ID: blank(z.string().max(11).optional()),
  SMS_CALLBACK_SECRET: optional,
  KHAYA_API_KEY: optional,
  KHAYA_BASE_URL: z.url().default('https://translation-api.ghananlp.org'),
  DHIS2_BASE_URL: blank(z.url().optional()),
  DHIS2_USERNAME: optional,
  DHIS2_PASSWORD: optional,
  DHIS2_MAPPING_FILE: optional,
  CONTENT_DIR: z.string().default('./content'),
})

const parsed = Env.safeParse(process.env)
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
  console.error(`Invalid environment (see apps/api/.env.example):\n${lines.join('\n')}`)
  process.exit(1)
}

export const env = parsed.data

export type Env = z.infer<typeof Env>
