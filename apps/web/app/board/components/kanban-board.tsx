'use client'

import { DragDropContext, type DropResult } from '@hello-pangea/dnd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { KanbanColumn, type Category } from './kanban-column'
import { type Card } from './card-item'

async function fetchCategories(): Promise<Category[]> {
  const res = await fetch('/api/categories')
  if (!res.ok) throw new Error('Failed to fetch categories')
  return res.json().then((d) => d.categories)
}

async function fetchCards(): Promise<Card[]> {
  const res = await fetch('/api/cards')
  if (!res.ok) throw new Error('Failed to fetch cards')
  return res.json().then((d) => d.cards)
}

export function KanbanBoard({
  initialCategories,
  initialCards,
}: {
  initialCategories: Category[]
  initialCards: Card[]
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const lastEventIdRef = useRef<number>(0)

  // SSE subscription — invalidates cards cache on card.created / card.updated
  useEffect(() => {
    let es: EventSource | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null

    function connect() {
      es = new EventSource(`/api/sse`)

      const invalidate = (event: MessageEvent) => {
        if (event.lastEventId) {
          lastEventIdRef.current = parseInt(event.lastEventId, 10)
        }
        queryClient.invalidateQueries({ queryKey: ['cards'] })
      }

      // Event names must match what the agent/API emits: dot notation
      es.addEventListener('card.created', invalidate)
      es.addEventListener('card.updated', invalidate)

      es.onerror = () => {
        es?.close()
        reconnectTimeout = setTimeout(connect, 3_000)
      }
    }

    connect()

    return () => {
      es?.close()
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
    }
  }, [queryClient])

  const { data: categories = initialCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    initialData: initialCategories,
  })

  const { data: cards = initialCards, isFetching: cardsFetching } = useQuery({
    queryKey: ['cards'],
    queryFn: fetchCards,
    initialData: initialCards,
  })

  const handleDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result
    if (!destination) return
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    )
      return

    // Optimistic update
    queryClient.setQueryData<Card[]>(['cards'], (old = []) =>
      old.map((card) =>
        card.id === draggableId
          ? { ...card, categoryId: destination.droppableId, position: destination.index }
          : card
      )
    )

    await fetch(`/api/cards/${draggableId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category_id: destination.droppableId,
        position: destination.index,
      }),
    })

    // Refresh from server to ensure consistency
    queryClient.invalidateQueries({ queryKey: ['cards'] })
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-4 md:flex-row md:overflow-x-auto pb-4 px-1">
        {categories.map((category) => (
          <KanbanColumn
            key={category.id}
            category={category}
            cards={cards.filter((c) => (c as unknown as { categoryId: string }).categoryId === category.id)}
            onCardClick={(cardId) => router.push(`/board/${cardId}`)}
            isLoading={cardsFetching && cards.length === 0}
          />
        ))}
        {categories.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground py-20">
            No columns yet — add one in{' '}
            <a href="/config" className="ml-1 underline">
              Config
            </a>
          </div>
        )}
      </div>
    </DragDropContext>
  )
}
