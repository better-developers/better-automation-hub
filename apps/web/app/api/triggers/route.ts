import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, asc } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { triggers } from '@/lib/db/schema'
import { CreateTriggerSchema } from '@/lib/schemas'

export async function GET() {
  const session = await requireSession()

  const rows = await db
    .select()
    .from(triggers)
    .where(eq(triggers.userId, session.user.id))
    .orderBy(asc(triggers.createdAt))

  return NextResponse.json({ triggers: rows })
}

export async function POST(req: NextRequest) {
  const session = await requireSession()

  let body: z.infer<typeof CreateTriggerSchema>
  try {
    body = CreateTriggerSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', code: 'VALIDATION_ERROR', details: err.issues },
        { status: 400 }
      )
    }
    throw err
  }

  const [trigger] = await db
    .insert(triggers)
    .values({
      userId:            session.user.id,
      categoryId:        body.category_id,
      name:              body.name,
      integration:       body.integration,
      schedule:          body.schedule,
      promptTemplate:    body.prompt_template,
      integrationConfig: body.integration_config ?? {},
      enabled:           body.enabled ?? true,
    })
    .returning()

  return NextResponse.json({ trigger }, { status: 201 })
}
