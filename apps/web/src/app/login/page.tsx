'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import Image from 'next/image'
import { Brand } from '@/components/shared/brand'
import { PasswordInput } from '@/components/shared/form-field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { homeFor } from '@/lib/nav'
import { errorCode, errorMessage } from '@/redux/api'
import { useLoginMutation } from '@/redux/endpoints'

const schema = z.object({ login: z.string().trim().min(3, 'Enter your email or phone number'), password: z.string().min(1, 'Enter your password') })

export default function LoginPage() {
  const router = useRouter()
  const [login, { error, isLoading }] = useLoginMutation()
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { login: '', password: '' } })

  async function onSubmit(values: z.infer<typeof schema>) {
    const res = await login(values).unwrap().catch(() => null)
    if (res) router.replace(homeFor(res.user.role))
  }

  const message = errorCode(error) === 'invalid_credentials' ? 'That email, phone or password is not right.' : errorCode(error) === 'rate_limited' ? 'Too many attempts. Wait 15 minutes and try again.' : error ? errorMessage(error) : null

  return (
    <main className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Story />
      <div className="grid min-h-dvh place-items-center bg-muted/40 px-4 py-8 lg:bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <Brand size={56} className="flex-col gap-3 lg:hidden" nameClassName="text-2xl font-bold" />
      <Card className="w-full max-w-sm max-sm:mx-0 max-sm:border-y-0 max-sm:ring-1">
        <CardHeader>
          <CardTitle className="text-xl"><h1>Sign in to Laafia</h1></CardTitle>
          <CardDescription>District, supervisor and facility accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* method="post" keeps credentials out of the URL if the form is submitted before the page has hydrated. */}
          <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login">Email or phone</Label>
              <Input id="login" autoComplete="username" placeholder="Email or phone number" className="h-11 text-base sm:text-sm" aria-invalid={!!form.formState.errors.login} {...form.register('login')} />
              {form.formState.errors.login ? <p className="text-sm text-destructive">{form.formState.errors.login.message}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" autoComplete="current-password" placeholder="Your password" className="h-11 text-base sm:text-sm" aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
              {form.formState.errors.password ? <p className="text-sm text-destructive">{form.formState.errors.password.message}</p> : null}
            </div>
            {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
            <Button type="submit" disabled={isLoading} className="h-11">{isLoading ? 'Signing in' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
      </div>
      </div>
    </main>
  )
}

/** The desktop panel beside the form: what Laafia is, in its own words and colours. */
function Story() {
  return (
    <aside className="hidden h-dvh flex-col justify-between gap-10 bg-primary p-12 text-primary-foreground lg:sticky lg:top-0 lg:flex xl:p-16">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center bg-white"><Image src="/logo.png" alt="" width={36} height={36} priority /></span>
        <span className="text-xl font-semibold tracking-tight">Laafia</span>
      </div>
      <div className="flex max-w-md flex-col gap-4">
        <h2 className="text-4xl leading-tight font-semibold tracking-tight">Every referral, from the community to discharge.</h2>
        <p className="text-lg text-white/85">Sent by SMS, followed to the facility, closed with a home visit.</p>
      </div>
      <p className="text-sm text-white/70">For district health teams, supervisors and facility staff.</p>
    </aside>
  )
}
