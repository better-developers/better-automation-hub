'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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
  actionType: string | null
  actionMetadata: Record<string, unknown> | null
  snoozedUntil: string | null
  actionError: string | null
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

async function postAction(body: {
  card_id: string
  action_type: string
  payload: Record<string, unknown>
}) {
  const res = await fetch('/api/actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to queue action')
  return res.json()
}

function defaultSnoozeValue() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

export function CardDetailSheet({ card }: { card: CardDetail }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(card.draftReply ?? '')
  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeDate, setSnoozeDate] = useState(defaultSnoozeValue)

  const { mutate: updateCard } = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchCard(card.id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cards'] }),
    onError: () => toast.error('Failed to update card'),
  })

  const { mutate: sendAction, isPending: isSending } = useMutation({
    mutationFn: () =>
      postAction({
        card_id:     card.id,
        action_type: card.actionType!,
        payload:     { ...(card.actionMetadata ?? {}), draft_reply: draft },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cards'] })
      toast.success('Reply sent \u2014 card queued for sending')
      router.back()
    },
    onError: () => toast.error('Failed to send reply'),
  })

  const handleDismiss = () => {
    updateCard(
      { status: 'dismissed' },
      {
        onSuccess: () => {
          toast.success('Card dismissed')
          router.back()
        },
      }
    )
  }

  const handleMarkReviewed = () => {
    updateCard(
      { status: 'reviewed', draft_reply: draft },
      { onSuccess: () => router.back() }
    )
  }

  const handleSaveDraft = () => {
    updateCard(
      { draft_reply: draft },
      { onSuccess: () => toast.success('Draft saved') }
    )
  }

  const handleSend = () => {
    updateCard({ draft_reply: draft })
    sendAction()
  }

  const handleSnooze = () => {
    if (!snoozeDate) return
    updateCard(
      { snoozed_until: new Date(snoozeDate).toISOString() },
      {
        onSuccess: () => {
          toast.success('Card snoozed')
          router.back()
        },
      }
    )
  }

  const handleUnsnooze = () => {
    updateCard(
      { snoozed_until: null },
      { onSuccess: () => toast.success('Card unsnoozed') }
    )
  }

  const isSnoozed =
    card.snoozedUntil != null && new Date(card.snoozedUntil) > new Date()

  return (
    <Sheet open onOpenChange={(open) => !open && router.back()}>
      <SheetContent className="w-full sm:max-w-xl h-[100dvh] sm:h-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base leading-snug pr-6">
            {card.title}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {card.actionError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-700 mb-1">Action failed</p>
              <p className="text-xs text-red-600 break-words">{card.actionError}</p>
            </div>
          )}

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
            {card.actionType && (
              <Button
                size="sm"
                onClick={handleSend}
                disabled={isSending || !draft.trim()}
              >
                {isSending ? 'Sending…' : 'Send'}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleSaveDraft}>
              Save draft
            </Button>
            <Button size="sm" onClick={handleMarkReviewed}>
              Mark reviewed
            </Button>
            {isSnoozed ? (
              <Button size="sm" variant="outline" onClick={handleUnsnooze}>
                Unsnooze
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSnooze((v) => !v)}
              >
                Snooze
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={handleDismiss}>
              Dismiss
            </Button>
          </div>

          {showSnooze && !isSnoozed && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
              <input
                type="datetime-local"
                value={snoozeDate}
                onChange={(e) => setSnoozeDate(e.target.value)}
                className="flex-1 rounded-md border px-2 py-1 text-sm bg-background"
              />
              <Button size="sm" onClick={handleSnooze} disabled={!snoozeDate}>
                Confirm
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
