'use client'

import { Droppable } from '@hello-pangea/dnd'
import { CardItem, type Card } from './card-item'

export interface Category {
  id: string
  name: string
  color: string
}

export function KanbanColumn({
  category,
  cards,
  onCardClick,
}: {
  category: Category
  cards: Card[]
  onCardClick: (cardId: string) => void
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: category.color }}
        />
        <h2 className="text-sm font-semibold truncate">{category.name}</h2>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {cards.length}
        </span>
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
            {cards.map((card, index) => (
              <CardItem
                key={card.id}
                card={card}
                index={index}
                onClick={() => onCardClick(card.id)}
              />
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}
