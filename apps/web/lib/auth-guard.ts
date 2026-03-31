import { auth } from './auth'
import { headers } from 'next/headers'
import { db } from './db/client'
import { users } from './db/schema'

export async function requireSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session?.user) {
    throw new Response(
      JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Ensure app-level users row exists — covers users who signed in before
  // the signIn callback was deployed and still hold a valid JWT.
  await db
    .insert(users)
    .values({
      id:    session.user.id,
      email: session.user.email,
      name:  session.user.name ?? '',
    })
    .onConflictDoNothing()

  return session
}
