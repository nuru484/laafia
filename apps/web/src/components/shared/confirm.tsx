'use client'

import { useCallback, useRef, useState } from 'react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export type Ask = { title: string; body: string; confirm: string; destructive?: boolean }

/**
 * Confirmation before an action that cannot be taken back. Render `dialog` once in the page, then
 * `if (await confirm({...}))` runs the action only after the user agrees.
 */
export function useConfirm(): [(ask: Ask) => Promise<boolean>, React.ReactNode] {
  const [ask, setAsk] = useState<Ask | null>(null)
  const resolve = useRef<((ok: boolean) => void) | null>(null)
  const confirm = useCallback((a: Ask) => new Promise<boolean>((r) => { resolve.current = r; setAsk(a) }), [])
  const settle = (ok: boolean) => {
    resolve.current?.(ok)
    resolve.current = null
    setAsk(null)
  }
  const dialog = (
    <AlertDialog open={!!ask} onOpenChange={(open) => { if (!open) settle(false) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{ask?.title}</AlertDialogTitle>
          <AlertDialogDescription>{ask?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction className="h-11" variant={ask?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>{ask?.confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return [confirm, dialog]
}
