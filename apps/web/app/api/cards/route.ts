import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and, asc, inArray, desc } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { cards, actionQueue } from '@/lib/db/schema'
import { CreateCardSchema } from '@/lib/schemas'

export async function GET(req: NextRequest) {
  const session = await requireSession()
  const { searchParams } = req.nextUrl

  const conditions = [eq(cards.userId, session.user.id)]
  const categoryId = searchParams.get('category_id')
  const status = searchParams.get('status')

  if (categoryId) conditions.push(eq(cards.categoryId, categoryId))
  if (status)     conditions.push(eq(cards.status, status as 'pending' | 'reviewed' | 'approved' | 'sending' | 'done' | 'dismissed'))

  const rows = await db
    .select()
    .from(cards)
    .where(and(...conditions))
    .orderBy(asc(cards.position))

  // Attach the most recent failed-action error to each card currently in 'pending' status
  const pendingCardIds = rows.filter((c) => c.status === 'pending').map((c) => c.id)
  const errorByCardId = new Map<string, string>()

  if (pendingCardIds.length > 0) {
    const failedActions = await db
      .select({ cardId: actionQueue.cardId, error: actionQueue.error })
      .from(actionQueue)
      .where(
        and(
          eq(actionQueue.userId, session.user.id),
          eq(actionQueue.status, 'failed'),
          inArray(actionQueue.cardId, pendingCardIds),
        ),
      )
      .orderBy(desc(actionQueue.processedAt))

    for (const fa of failedActions) {
      if (!errorByCardId.has(fa.cardId) && fa.error) {
        errorByCardId.set(fa.cardId, fa.error)
      }
    }
  }

  return NextResponse.json({
    cards: rows.map((c) => ({
      ...c,
      action_error: errorByCardId.get(c.id) ?? null,
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await requireSession()

  let body: z.infer<typeof CreateCardSchema>
  try {
    body = CreateCardSchema.parse(await req.json())
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
    .insert(cards)
    .values({
      userId:     session.user.id,
      categoryId: body.category_id,
      title:      body.title,
      summary:    body.summary,
      draftReply: body.draft_reply,
      status:     'pending',
      position:   0,
    })
    .returning()

  return NextResponse.json({ card }, { status: 201 })
}
