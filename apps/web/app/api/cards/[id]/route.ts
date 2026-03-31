import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { cards } from '@/lib/db/schema'
import { PatchCardSchema } from '@/lib/schemas'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  let body: z.infer<typeof PatchCardSchema>
  try {
    body = PatchCardSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: err.issues },
        { status: 400 }
      )
    }
    throw err
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() }
  if (body.category_id   !== undefined) updates.categoryId   = body.category_id
  if (body.position      !== undefined) updates.position     = body.position
  if (body.status        !== undefined) updates.status       = body.status
  if (body.draft_reply   !== undefined) updates.draftReply   = body.draft_reply
  if (body.snoozed_until !== undefined) {
    updates.snoozedUntil = body.snoozed_until ? new Date(body.snoozed_until) : null
  }

  const [card] = await db
    .update(cards)
    .set(updates)
    .where(and(eq(cards.id, params.id), eq(cards.userId, session.user.id)))
    .returning()

  if (!card) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({ card })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  const [card] = await db
    .delete(cards)
    .where(and(eq(cards.id, params.id), eq(cards.userId, session.user.id)))
    .returning()

  if (!card) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
