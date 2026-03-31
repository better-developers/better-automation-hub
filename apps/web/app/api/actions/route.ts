import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { actionQueue, cards } from '@/lib/db/schema'
import { CreateActionSchema } from '@/lib/schemas'
import { emitSseEvent } from '@/lib/sse'

export async function POST(req: NextRequest) {
  const session = await requireSession()

  let body: z.infer<typeof CreateActionSchema>
  try {
    body = CreateActionSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: err.issues },
        { status: 400 }
      )
    }
    throw err
  }

  const [card] = await db
    .select()
    .from(cards)
    .where(and(eq(cards.id, body.card_id), eq(cards.userId, session.user.id)))

  if (!card) {
    return NextResponse.json({ error: 'Card not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const [action] = await db
    .insert(actionQueue)
    .values({
      userId:     session.user.id,
      cardId:     body.card_id,
      actionType: body.action_type,
      payload:    body.payload,
      status:     'queued',
    })
    .returning()

  const [updatedCard] = await db
    .update(cards)
    .set({ status: 'approved', updatedAt: new Date() })
    .where(eq(cards.id, body.card_id))
    .returning()

  await emitSseEvent(session.user.id, 'card.updated', { card: updatedCard })

  return NextResponse.json({ action }, { status: 201 })
}
