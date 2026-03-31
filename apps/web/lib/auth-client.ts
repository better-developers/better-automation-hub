'use client'

import { createAuthClient } from 'better-auth/react'

export const { signIn, signOut, useSession } = createAuthClient({
  // Always points at the stable auth domain, not the preview URL.
  // This is baked in at build time via NEXT_PUBLIC_AUTH_URL.
  baseURL: process.env.NEXT_PUBLIC_AUTH_URL!,
})
