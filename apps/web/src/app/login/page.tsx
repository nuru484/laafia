'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
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
    <main className="grid min-h-dvh place-items-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl"><h1>Sign in to Laafia</h1></CardTitle>
          <CardDescription>District, supervisor and facility accounts.</CardDescription>
        </CardHeader>
        <CardContent>
          {/* method="post" keeps credentials out of the URL if the form is submitted before the page has hydrated. */}
          <form method="post" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login">Email or phone</Label>
              <Input id="login" autoComplete="username" className="text-base sm:text-sm" aria-invalid={!!form.formState.errors.login} {...form.register('login')} />
              {form.formState.errors.login ? <p className="text-sm text-destructive">{form.formState.errors.login.message}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" className="text-base sm:text-sm" aria-invalid={!!form.formState.errors.password} {...form.register('password')} />
              {form.formState.errors.password ? <p className="text-sm text-destructive">{form.formState.errors.password.message}</p> : null}
            </div>
            {message ? <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert> : null}
            <Button type="submit" disabled={isLoading} className="h-11">{isLoading ? 'Signing in' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
