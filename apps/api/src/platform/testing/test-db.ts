import { userInfo } from 'node:os'

/** A dedicated database for the suite: tests delete every row between cases. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? `postgresql://${userInfo().username}@localhost/laafia_api_test?host=/var/run/postgresql`
