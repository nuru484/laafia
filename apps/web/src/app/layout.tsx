import type { Metadata } from 'next'
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
import { StoreProvider } from '@/redux/provider'
import './globals.css'

// Atkinson Hyperlegible tells 0 from O and 1 from l and I: codes and phone numbers are copied by hand.
const sans = Atkinson_Hyperlegible_Next({ subsets: ['latin'], variable: '--font-sans' })
const mono = Atkinson_Hyperlegible_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = { title: { default: 'Laafia', template: '%s · Laafia' }, description: 'Referrals and visits for community health in Northern Ghana' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', sans.variable, mono.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <StoreProvider>{children}</StoreProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
