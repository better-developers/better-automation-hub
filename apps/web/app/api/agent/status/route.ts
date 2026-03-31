import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { agentSessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  let session: Awaited<ReturnType<typeof requireSession>>
  try {
    session = await requireSession()
  } catch (response) {
    return response as Response
  }

  const [row] = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.userId, session.user.id))
    .limit(1)

  if (!row) {
    return Response.json({ online: false, last_seen: null, seconds_ago: null, integrations: [] })
  }

  const secondsAgo = Math.floor((Date.now() - row.lastSeen.getTime()) / 1000)
  const online = secondsAgo < 120

  return Response.json({
    online,
    last_seen: row.lastSeen.toISOString(),
    seconds_ago: secondsAgo,
    integrations: row.integrations ?? [],
  })
}
