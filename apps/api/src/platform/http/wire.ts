/*
 * The wire (sync JSON, every API response) uses snake_case keys equal to the
 * SQL column names; Prisma models use camelCase fields mapped to them. These
 * convert top-level keys only: JSON column contents (answers, counts) are kept as-is.
 */

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

export function toWire<T extends object>(row: T, omit: string[] = ['seq']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (!omit.includes(k)) out[snake(k)] = v
  return out
}

export function fromWire(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]))
}
