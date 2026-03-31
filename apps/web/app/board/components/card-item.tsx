'use client'

import { Draggable } from '@hello-pangea/dnd'

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-800',
  reviewed:  'bg-blue-100 text-blue-800',
  approved:  'bg-purple-100 text-purple-800',
  sending:   'bg-yellow-100 text-yellow-800',
  done:      'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-800',
}

export interface Card {
  id: string
  title: string
  summary: string | null
  status: string
  createdAt: string | Date
  snoozedUntil: string | Date | null
}

export function CardItem({
  card,
  index,
  onClick,
}: {
  card: Card
  index: number
  onClick: () => void
}) {
  return (
    <Draggable draggableId={card.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={[
            'rounded-lg border bg-card p-3 shadow-sm cursor-pointer',
            'hover:shadow-md transition-shadow select-none',
            snapshot.isDragging ? 'shadow-lg rotate-1 opacity-90' : '',
          ].join(' ')}
        >
          <p className="text-sm font-medium line-clamp-2 leading-snug">
            {card.title}
          </p>
          {card.summary && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {card.summary}
            </p>
          )}
          <div className="mt-2">
            <span
              className={`text-xs rounded-full px-2 py-0.5 font-medium ${STATUS_COLORS[card.status] ?? 'bg-gray-100 text-gray-800'}`}
            >
              {card.status}
            </span>
          </div>
        </div>
      )}
    </Draggable>
  )
}
