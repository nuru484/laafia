import { networkInterfaces } from 'node:os'
import { createApp } from './app.ts'
import { buildDeps } from './platform/deps.ts'
import { startJobWorker } from './platform/jobs/worker.ts'

const deps = buildDeps()
// Phones on the same network reach the API on the machine's LAN address, so list those too.
const lan = Object.values(networkInterfaces()).flat().filter((a) => a?.family === 'IPv4' && !a.internal && !a.address.startsWith('172.17.')).map((a) => a!.address)
const urls = ['localhost', ...lan].map((h) => `http://${h}:${deps.env.PORT}`)
const server = createApp(deps).listen(deps.env.PORT, () => deps.logger.info('listening', { urls }))
const stopJobs = startJobWorker(deps)

const shutdown = () => {
  stopJobs()
  server.close(() => void deps.prisma.$disconnect().then(() => process.exit(0)))
  server.closeAllConnections() // SSE streams never end on their own
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
