import Image from 'next/image'
import { cn } from '@/lib/utils'

/** The emblem and the name: sidebar, phone bar and sign-in page. */
export function Brand({ size = 32, className, nameClassName }: { size?: number; className?: string; nameClassName?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Image src="/logo.png" alt="" width={size} height={size} priority className="shrink-0 object-contain" />
      <span className={cn('text-base font-semibold tracking-tight', nameClassName)}>Laafia</span>
    </span>
  )
}
