import { execFileSync } from 'node:child_process'
import { TEST_DATABASE_URL } from './test-db.ts'

/** Bring the test database to the current migrations once per run (non-destructive; rows are cleared per test). */
export default function setup() {
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, stdio: 'pipe' })
}
