import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { triggers, manualRunRequests } from '@/lib/db/schema'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  const [trigger] = await db
    .select({ id: triggers.id })
    .from(triggers)
    .where(and(eq(triggers.id, params.id), eq(triggers.userId, session.user.id)))

  if (!trigger) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  await db.insert(manualRunRequests).values({
    triggerId: trigger.id,
    userId: session.user.id,
  })

  return NextResponse.json({ ok: true })
}
