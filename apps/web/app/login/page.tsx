'use client'

import { Suspense, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { signIn } from '@/lib/auth-client'

function LoginForm() {
  const params = useSearchParams()
  const router = useRouter()
  const callbackPath = params.get('callbackUrl') ?? '/board'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleMicrosoft = async () => {
    await signIn.social({
      provider: 'microsoft',
      callbackURL: `${window.location.origin}${callbackPath}`,
    })
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await signIn.email({
        email,
        password,
        callbackURL: `${window.location.origin}${callbackPath}`,
      })
      if (result?.error) {
        setError(result.error.message ?? 'Invalid email or password')
      } else {
        router.push(callbackPath)
      }
    } catch {
      setError('Something went wrong, please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={handleMicrosoft}
        className="flex w-full items-center justify-center gap-2 rounded-lg border px-6 py-3 text-sm font-medium hover:bg-muted transition-colors"
      >
        Sign in with Microsoft
      </button>

      <div className="flex w-full items-center gap-3">
        <div className="flex-1 border-t" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="flex-1 border-t" />
      </div>

      <form onSubmit={handleEmailLogin} className="flex w-full flex-col gap-3">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-lg border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-lg border bg-background px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-xl border bg-card p-10 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Claude Automation Hub</h1>
        <p className="text-sm text-muted-foreground">Sign in to access your board</p>
        <Suspense fallback={
          <div className="w-full animate-pulse space-y-3">
            <div className="h-10 rounded-lg bg-muted" />
            <div className="h-10 rounded-lg bg-muted" />
          </div>
        }>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
