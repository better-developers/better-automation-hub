'use client'

import { Droppable } from '@hello-pangea/dnd'
import { CardItem, type Card } from './card-item'
import { Skeleton } from '@/components/ui/skeleton'

export interface Category {
  id: string
  name: string
  color: string
}

export function KanbanColumn({
  category,
  cards,
  onCardClick,
  isLoading = false,
}: {
  category: Category
  cards: Card[]
  onCardClick: (cardId: string) => void
  isLoading?: boolean
}) {
  const now = new Date()
  const visibleCards = cards.filter(
    (c) => !c.snoozedUntil || new Date(c.snoozedUntil as string) < now
  )
  const snoozedCount = cards.length - visibleCards.length

  return (
    <div className="flex w-full md:w-72 md:shrink-0 flex-col rounded-xl bg-muted/50 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: category.color }}
        />
        <h2 className="text-sm font-semibold truncate">{category.name}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {snoozedCount > 0 && (
            <span className="text-xs rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 font-medium">
              {snoozedCount} snoozed
            </span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {isLoading ? '…' : visibleCards.length}
          </span>
        </div>
      </div>
      <Droppable droppableId={category.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={[
              'flex flex-col gap-2 min-h-16 rounded-lg p-1 transition-colors',
              snapshot.isDraggingOver ? 'bg-muted' : '',
            ].join(' ')}
          >
            {isLoading ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : (
              <>
                {visibleCards.length === 0 && !snapshot.isDraggingOver && (
                  <div className="flex flex-col items-center justify-center py-8 px-3 text-center">
                    <p className="text-xs text-muted-foreground">
                      No cards yet &mdash; triggers will populate this
                    </p>
                  </div>
                )}
                {visibleCards.map((card, index) => (
                  <CardItem
                    key={card.id}
                    card={card}
                    index={index}
                    onClick={() => onCardClick(card.id)}
                  />
                ))}
              </>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}
