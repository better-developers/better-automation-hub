import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, asc } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { categories } from '@/lib/db/schema'
import { CreateCategorySchema } from '@/lib/schemas'

export async function GET() {
  const session = await requireSession()

  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.userId, session.user.id))
    .orderBy(asc(categories.position))

  return NextResponse.json({ categories: rows })
}

export async function POST(req: NextRequest) {
  const session = await requireSession()

  let body: z.infer<typeof CreateCategorySchema>
  try {
    body = CreateCategorySchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: err.issues },
        { status: 400 }
      )
    }
    throw err
  }

  const [category] = await db
    .insert(categories)
    .values({
      userId:   session.user.id,
      name:     body.name,
      color:    body.color ?? '#6366f1',
      position: body.position ?? 0,
    })
    .returning()

  return NextResponse.json({ category }, { status: 201 })
}
