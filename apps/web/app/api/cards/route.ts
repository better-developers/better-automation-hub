import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and, asc } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { cards } from '@/lib/db/schema'
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

  return NextResponse.json({ cards: rows })
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
