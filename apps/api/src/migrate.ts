import { pool, runMigrations } from './db.ts'

await runMigrations()
console.log('migrations applied')
await pool.end()
