import { NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { agentSessions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET() {
  let session: Awaited<ReturnType<typeof requireSession>>
  try {
    session = await requireSession()
  } catch (res) {
    return res as Response
  }

  const userId = session.user.id

  const rows = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.userId, userId))
    .limit(1)

  if (rows.length === 0) {
    return NextResponse.json({
      online: false,
      last_seen: null,
      seconds_ago: null,
      integrations: [],
    })
  }

  const row = rows[0]
  const secondsAgo = Math.floor(
    (Date.now() - new Date(row.lastSeen).getTime()) / 1000
  )
  const online = secondsAgo < 120

  return NextResponse.json({
    online,
    last_seen: row.lastSeen,
    seconds_ago: secondsAgo,
    integrations: row.integrations ?? [],
  })
}
