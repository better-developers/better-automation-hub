import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and, count } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { categories, cards } from '@/lib/db/schema'
import { PatchCategorySchema } from '@/lib/schemas'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  let body: z.infer<typeof PatchCategorySchema>
  try {
    body = PatchCategorySchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: err.issues },
        { status: 400 }
      )
    }
    throw err
  }

  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, params.id), eq(categories.userId, session.user.id)))

  if (!existing) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const [category] = await db
    .update(categories)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.color !== undefined && { color: body.color }),
      ...(body.position !== undefined && { position: body.position }),
    })
    .where(eq(categories.id, params.id))
    .returning()

  return NextResponse.json({ category })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, params.id), eq(categories.userId, session.user.id)))

  if (!existing) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const [{ cardCount }] = await db
    .select({ cardCount: count() })
    .from(cards)
    .where(eq(cards.categoryId, params.id))

  if (cardCount > 0) {
    return NextResponse.json(
      { error: 'Category has cards', code: 'CATEGORY_HAS_CARDS' },
      { status: 409 }
    )
  }

  await db.delete(categories).where(eq(categories.id, params.id))

  return new NextResponse(null, { status: 204 })
}
