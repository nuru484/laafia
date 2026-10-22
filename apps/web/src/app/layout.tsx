import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { StoreProvider } from '@/redux/provider'
import './globals.css'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = { title: { default: 'Laafia', template: '%s · Laafia' }, description: 'Referrals and visits for community health in Northern Ghana' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <StoreProvider>{children}</StoreProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
