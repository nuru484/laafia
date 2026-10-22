import { EventEmitter } from 'node:events'
import { env as processEnv, type Env } from '../config/env.ts'
import { createPrisma, type Db } from './db.ts'
import { createLogger, type Logger } from './logger.ts'
import { createSmsGateway, type SmsGateway } from './sms-gateway.ts'

/**
 * Everything a service may touch, built once in server.ts (or by a test) and
 * passed down. Services never import the Prisma client, env or gateways
 * directly, so a test can swap any of them.
 */
export type Deps = {
  prisma: Db
  env: Env
  logger: Logger
  sms: SmsGateway
  clock: () => number
  /** In-process bus feeding /events (SSE). Emits 'referral' with a ReferralView after the write commits. */
  bus: EventEmitter
}

export function buildDeps(over: Partial<Deps> = {}): Deps {
  const env = over.env ?? processEnv
  const logger = over.logger ?? createLogger()
  const bus = over.bus ?? new EventEmitter()
  const clock = over.clock ?? Date.now
  bus.setMaxListeners(0)
  return {
    env,
    logger,
    bus,
    prisma: over.prisma ?? createPrisma(env.DATABASE_URL),
    sms: over.sms ?? createSmsGateway(env, logger),
    clock,
  }
}
