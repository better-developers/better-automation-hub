'use client'

import { useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'

export default function LoginPage() {
  const params = useSearchParams()
  const callbackPath = params.get('callbackUrl') ?? '/board'

  const handleSignIn = async () => {
    // Pass the full origin so BetterAuth redirects back to whichever
    // preview URL (or prod) the user came from, not the auth domain.
    await signIn.social({
      provider: 'microsoft',
      callbackURL: `${window.location.origin}${callbackPath}`,
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 rounded-xl border bg-card p-10 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Claude Automation Hub</h1>
        <p className="text-sm text-muted-foreground">Sign in to access your board</p>
        <button
          onClick={handleSignIn}
          className="flex items-center gap-2 rounded-lg border px-6 py-3 text-sm font-medium hover:bg-muted transition-colors"
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  )
}
