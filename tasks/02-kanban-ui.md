# 02 — Kanban UI (Next.js / React)

## Pages

```
/                       → redirect to /board
/board                  → main Kanban view
/board/[cardId]         → card detail (sheet overlay, URL-addressable)
/config                 → automation config
/config/triggers/new
/config/triggers/[id]
```

---

## Component tree

```
<RootLayout>
  └── <Providers>                  ← NextAuth SessionProvider + React Query
       ├── <BoardPage>
       │    ├── <BoardHeader>      ← title, agent status badge
       │    ├── <KanbanBoard>      ← horizontal scroll, SSE subscription
       │    │    └── <KanbanColumn> × N
       │    │         ├── <ColumnHeader>
       │    │         ├── <CardList>   ← @hello-pangea/dnd droppable
       │    │         │    └── <CardItem> × N
       │    │         └── <AddCardButton>
       │    └── <CardDetailSheet>  ← right-side sheet
       │         ├── <CardMeta>
       │         ├── <OriginalContent>  ← collapsible
       │         ├── <DraftEditor>
       │         └── <CardActions>     ← Send, Dismiss, Move, Snooze
       └── <ConfigPage>
            ├── <CategoryList>
            ├── <TriggerList>
            └── <TriggerForm>
```

---

## SSE subscription in `<KanbanBoard>`

The board opens a persistent SSE connection to `GET /api/sse` and updates the React Query cache when events arrive. No Supabase needed.

```typescript
// components/KanbanBoard.tsx
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

export function KanbanBoard() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const es = new EventSource('/api/sse')

    es.addEventListener('card.created', (e) => {
      const card = JSON.parse(e.data)
      queryClient.setQueryData(['cards'], (old: Card[]) => [card, ...(old ?? [])])
    })

    es.addEventListener('card.updated', (e) => {
      const card = JSON.parse(e.data)
      queryClient.setQueryData(['cards'], (old: Card[]) =>
        old?.map(c => c.id === card.id ? card : c) ?? []
      )
    })

    es.onerror = () => {
      // EventSource auto-reconnects — no manual retry needed
    }

    return () => es.close()
  }, [queryClient])

  // ... rest of board render
}
```

---

## Key components

### `<CardItem>`

Compact view on the column face:

```
┌────────────────────────────────────┐
│ 🔵 Outlook · 2 min ago              │
│ Re: Q2 budget review                │
│ "Sure, I can join the call at…"     │
│ [Pending]              [→ Open]     │
└────────────────────────────────────┘
```

Status badge colours: `pending` = amber, `reviewed` = blue, `approved` = purple, `done` = green, `dismissed` = gray.

### `<CardDetailSheet>`

Right-side sheet (shadcn/ui `<Sheet>`). Sections:

1. **Header** — title, integration badge + icon, timestamp
2. **Original content** — collapsible accordion with raw email/Teams/GitHub content
3. **Draft reply** — `<Textarea>` pre-filled with `draft_reply`, freely editable
4. **Sticky action bar**:
   - **Send** → `POST /api/actions` → card status = `approved`
   - **Dismiss** → `PATCH /api/cards/:id` status = `dismissed`
   - **Move** → category dropdown → `PATCH /api/cards/:id` category_id
   - **Snooze** → date picker → `PATCH /api/cards/:id` snoozed_until

### `<AgentStatusBadge>`

Polls `GET /api/agent/status` every 30 seconds.

```
● Online  (last seen 8s ago)    ← green dot
● Offline (last seen 9 min ago) ← red dot
```

Clicking opens a popover listing active integrations.

### `<TriggerForm>`

Fields: name, integration (select), category (select), schedule (cron presets + custom), prompt textarea with variable hint bar, enabled toggle.

Integration-specific extra fields appear conditionally:
- **Teams** → team ID + channel ID inputs
- **GitHub** → owner/repo input, multi-select of watch events (issues, PRs, comments, mentions)

---

## State management

- **TanStack Query v5** — all server state (cards, categories, triggers)
- **SSE** — pushes updates directly into Query cache (no polling)
- **React local state** — selected card ID, sheet open state, drag state

---

## Snoozed cards

Cards with `snoozed_until > now()` are filtered out client-side:

```typescript
const visibleCards = cards.filter(c =>
  !c.snoozed_until || new Date(c.snoozed_until) < new Date()
)
```

A small "snoozed" count badge on the column header shows how many are hidden.

---

## Dependencies

```json
{
  "@hello-pangea/dnd": "^16",
  "@tanstack/react-query": "^5",
  "next-auth": "^5",
  "shadcn-ui": "latest",
  "tailwindcss": "^3",
  "date-fns": "^3",
  "react-hook-form": "^7",
  "zod": "^3"
}
```

---

## Tasks checklist

### Setup
- [ ] `npx create-next-app@latest --typescript --tailwind --app`
- [ ] Install and init shadcn/ui
- [ ] Configure React Query provider in root layout
- [ ] Configure NextAuth (see `06-auth.md`)
- [ ] Configure Drizzle client (see `01-database.md`)

### Board
- [ ] `BoardPage` — fetch categories + cards
- [ ] `KanbanBoard` — SSE subscription wired to Query cache
- [ ] `KanbanColumn` — droppable, card count
- [ ] `CardItem` — compact face with status badge
- [ ] `CardDetailSheet` — full detail, draft editor, action bar
- [ ] Drag between columns → `PATCH /api/cards/:id`
- [ ] `AgentStatusBadge` — polling + popover

### Config
- [ ] `/config` page with Categories + Triggers tabs
- [ ] `CategoryList` — inline edit, colour picker, reorder
- [ ] `TriggerList` — enable/disable toggle, edit button
- [ ] `TriggerForm` — all fields + conditional integration config
- [ ] "Run now" button

### Polish
- [ ] Empty state per column
- [ ] Loading skeletons
- [ ] Toast notifications (Sonner)
- [ ] Snoozed count badge
- [ ] Mobile layout
