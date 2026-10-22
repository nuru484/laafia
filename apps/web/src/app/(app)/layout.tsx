'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { AppShell } from '@/components/shared/app-shell'
import { ErrorState, LoadingRows } from '@/components/shared/page'
import { errorMessage } from '@/redux/api'
import { useMeQuery } from '@/redux/endpoints'

/** Every dashboard page needs a signed-in user; the API enforces each role's scope on its own routes. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { data, error, isLoading, refetch } = useMeQuery()
  const router = useRouter()
  const unauthenticated = (error as { status?: number } | undefined)?.status === 401

  useEffect(() => {
    if (unauthenticated) router.replace('/login')
  }, [unauthenticated, router])

  if (isLoading || unauthenticated) return <div className="p-6"><LoadingRows /></div>
  if (error || !data) return <div className="p-6"><ErrorState message={errorMessage(error)} onRetry={refetch} /></div>
  return <AppShell user={data.user}>{children}</AppShell>
}
