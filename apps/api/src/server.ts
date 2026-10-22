import { createApp } from './app.ts'
import { env } from './env.ts'
import { pool } from './db.ts'
import { log } from './http.ts'
import { startJobWorker } from './sms.ts'

const port = env.PORT
const server = createApp().listen(port, () => log('info', 'listening', { port }))
const stopJobs = startJobWorker()

const shutdown = () => {
  stopJobs()
  server.close(() => void pool.end().then(() => process.exit(0)))
  server.closeAllConnections() // SSE streams never end on their own
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
