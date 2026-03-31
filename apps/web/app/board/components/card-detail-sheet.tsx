'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

interface CardDetail {
  id: string
  title: string
  summary: string | null
  draftReply: string | null
  status: string
  originalContent: Record<string, unknown> | string | null
}

async function patchCard(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/cards/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to update card')
  return res.json()
}

export function CardDetailSheet({ card }: { card: CardDetail }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(card.draftReply ?? '')

  const { mutate: updateCard } = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchCard(card.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cards'] }),
  })

  const handleDismiss = () => {
    updateCard({ status: 'dismissed' })
    router.back()
  }

  const handleMarkReviewed = () => {
    updateCard({ status: 'reviewed', draft_reply: draft })
    router.back()
  }

  const handleSaveDraft = () => {
    updateCard({ draft_reply: draft })
  }

  return (
    <Sheet open onOpenChange={(open) => !open && router.back()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base leading-snug pr-6">
            {card.title}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {card.summary && (
            <p className="text-sm text-muted-foreground">{card.summary}</p>
          )}

          {card.originalContent && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Original content
              </p>
              <pre className="text-xs whitespace-pre-wrap break-words">
                {typeof card.originalContent === 'string'
                  ? card.originalContent
                  : JSON.stringify(card.originalContent as object, null, 2)}
              </pre>
            </div>
          )}

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              Draft reply
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a reply…"
              rows={6}
              className="resize-none text-sm"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={handleSaveDraft}>
              Save draft
            </Button>
            <Button size="sm" onClick={handleMarkReviewed}>
              Mark reviewed
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
