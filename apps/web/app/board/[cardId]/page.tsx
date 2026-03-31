import { eq, and } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { cards } from '@/lib/db/schema'
import { CardDetailSheet } from '../components/card-detail-sheet'

export default async function CardDetailPage({
  params,
}: {
  params: { cardId: string }
}) {
  const session = await requireSession()

  const card = await db.query.cards.findFirst({
    where: and(eq(cards.id, params.cardId), eq(cards.userId, session.user.id)),
  })

  if (!card) notFound()

  return (
    <CardDetailSheet
      card={{
        id:              card.id,
        title:           card.title,
        summary:         card.summary ?? null,
        draftReply:      card.draftReply ?? null,
        status:          card.status,
        originalContent: card.originalContent as Record<string, unknown> | string | null,
        actionType:      card.actionType ?? null,
        actionMetadata:  card.actionMetadata as Record<string, unknown> | null,
        snoozedUntil:    card.snoozedUntil ? card.snoozedUntil.toISOString() : null,
      }}
    />
  )
}
