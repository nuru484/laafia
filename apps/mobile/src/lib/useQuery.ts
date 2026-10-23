import { useCallback, useEffect, useState } from 'react'
import { subscribe } from './runtime'

/** Runs an async read, and again whenever the runtime reports a change (new SMS, send result, sync). */
export function useQuery<T>(read: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; error: Error | null; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    // A read that throws before it returns a promise (env() after sign-out) must not break the change broadcast.
    Promise.resolve().then(read).then((d) => { setData(d); setError(null) }, (e: unknown) => setError(e instanceof Error ? e : new Error(String(e))))
  }, deps)
  useEffect(() => {
    run()
    return subscribe(run)
  }, [run])
  return { data, error, reload: run }
}
