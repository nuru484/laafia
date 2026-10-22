import { createApp } from './app.ts'
import { failInterruptedBuilds } from './modules/content/maps.service.ts'
import { buildDeps } from './platform/deps.ts'
import { startJobWorker } from './platform/jobs/worker.ts'

const deps = buildDeps()
await failInterruptedBuilds(deps)
const server = createApp(deps).listen(deps.env.PORT, () => deps.logger.info('listening', { port: deps.env.PORT }))
const stopJobs = startJobWorker(deps)

const shutdown = () => {
  stopJobs()
  server.close(() => void deps.prisma.$disconnect().then(() => process.exit(0)))
  server.closeAllConnections() // SSE streams never end on their own
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
