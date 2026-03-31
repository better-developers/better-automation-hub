import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { triggers } from '@/lib/db/schema'
import { PatchTriggerSchema } from '@/lib/schemas'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  let body: z.infer<typeof PatchTriggerSchema>
  try {
    body = PatchTriggerSchema.parse(await req.json())
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
    .select({ id: triggers.id })
    .from(triggers)
    .where(and(eq(triggers.id, params.id), eq(triggers.userId, session.user.id)))

  if (!existing) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  const [trigger] = await db
    .update(triggers)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.integration !== undefined && { integration: body.integration }),
      ...(body.category_id !== undefined && { categoryId: body.category_id }),
      ...(body.schedule !== undefined && { schedule: body.schedule }),
      ...(body.prompt_template !== undefined && { promptTemplate: body.prompt_template }),
      ...(body.integration_config !== undefined && { integrationConfig: body.integration_config }),
      ...(body.enabled !== undefined && { enabled: body.enabled }),
    })
    .where(eq(triggers.id, params.id))
    .returning()

  return NextResponse.json({ trigger })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireSession()

  const [existing] = await db
    .select({ id: triggers.id })
    .from(triggers)
    .where(and(eq(triggers.id, params.id), eq(triggers.userId, session.user.id)))

  if (!existing) {
    return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
  }

  await db.delete(triggers).where(eq(triggers.id, params.id))

  return new NextResponse(null, { status: 204 })
}
