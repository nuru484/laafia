/** The few calls the app makes on SQLite; implemented by expo-sqlite on the phone and node:sqlite in tests. */
export type Param = string | number | null
export interface Db {
  exec(sql: string): Promise<void>
  run(sql: string, params?: Param[]): Promise<{ changes: number }>
  all<T>(sql: string, params?: Param[]): Promise<T[]>
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>
  tx<T>(fn: () => Promise<T>): Promise<T>
}
