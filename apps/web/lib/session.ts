import { NextRequest } from 'next/server'

/**
 * Lightweight edge-compatible session check.
 * Reads the BetterAuth JWT cookie without importing postgres.js.
 * Returns a truthy value if a session cookie is present (non-empty).
 * Full session validation happens in requireSession() inside API routes.
 */
export function getSessionFromRequest(req: NextRequest): boolean {
  const sessionCookie =
    req.cookies.get('better-auth.session_token')?.value ??
    req.cookies.get('__Secure-better-auth.session_token')?.value

  return Boolean(sessionCookie)
}
