# 03 — REST API (Next.js App Router) + SSE

All routes under `apps/web/app/api/`. Every route validates the session — unauthenticated requests get 401.

---

## Auth helper

```typescript
// lib/auth-guard.ts
import { auth } from '@/lib/auth'

export async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) {
    throw new Response('Unauthorized', { status: 401 })
  }
  return session
}
```

---

## SSE endpoint — `GET /api/sse`

This is the core realtime channel. The browser opens one persistent connection; the server tails the `sse_events` table and pushes new rows.

```typescript
// app/api/sse/route.ts
import { NextRequest } from 'next/server'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { sseEvents } from '@/lib/db/schema'
import { eq, gt, desc } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await requireSession()
  const userId = session.user.id

  const encoder = new TextEncoder()
  let lastId = 0

  // Start from current max id (don't replay old events on connect)
  const [latest] = await db
    .select({ id: sseEvents.id })
    .from(sseEvents)
    .where(eq(sseEvents.userId, userId))
    .orderBy(desc(sseEvents.id))
    .limit(1)
  if (latest) lastId = latest.id

  const stream = new ReadableStream({
    async start(controller) {
      // Send a keep-alive comment every 25s to prevent proxy timeouts
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': keep-alive\n\n'))
      }, 25_000)

      // Poll for new events every 2 seconds
      const poll = setInterval(async () => {
        const events = await db
          .select()
          .from(sseEvents)
          .where(eq(sseEvents.userId, userId))
          .where(gt(sseEvents.id, lastId))
          .orderBy(sseEvents.id)

        for (const event of events) {
          const data = `event: ${event.eventType}\ndata: ${JSON.stringify(event.payload)}\nid: ${event.id}\n\n`
          controller.enqueue(encoder.encode(data))
          lastId = event.id
        }
      }, 2_000)

      req.signal.addEventListener('abort', () => {
        clearInterval(keepAlive)
        clearInterval(poll)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Important for Traefik/Nginx — disables proxy buffering
    },
  })
}
```

**Note on `X-Accel-Buffering: no`:** Traefik and Nginx buffer responses by default. This header tells them not to buffer the SSE stream. Without it, events arrive in large batches instead of one at a time.

---

## Cards

### `GET /api/cards`

```typescript
// Returns all cards for the current user
// Query: ?status=pending,reviewed  ?category_id=uuid
```

**Response:**
```json
{
  "cards": [{
    "id": "uuid",
    "category_id": "uuid",
    "title": "Re: Q2 budget",
    "summary": "Sure, I can join the call…",
    "draft_reply": "Hi Jonas,\n\n…",
    "status": "pending",
    "action_type": "reply_email",
    "action_metadata": { "message_id": "…", "thread_id": "…" },
    "original_content": { "from": "…", "subject": "…", "body": "…" },
    "position": 0,
    "snoozed_until": null,
    "created_at": "2025-01-01T10:00:00Z"
  }]
}
```

### `POST /api/cards`

Manual card creation from the UI. The agent writes directly to Postgres — it does not use this route.

**Body:**
```json
{
  "category_id": "uuid",
  "title": "string",
  "summary": "string?",
  "draft_reply": "string?"
}
```

### `PATCH /api/cards/:id`

Update any mutable fields: `category_id`, `position`, `status`, `draft_reply`, `snoozed_until`.

### `DELETE /api/cards/:id`

Hard delete (prefer `status: dismissed`).

---

## Actions

### `POST /api/actions`

Called when the user clicks "Send". Writes to `action_queue`, updates card to `approved`, inserts SSE event.

```typescript
// app/api/actions/route.ts
export async function POST(req: Request) {
  const session = await requireSession()
  const body = CreateActionSchema.parse(await req.json())

  // Verify card belongs to user
  const card = await db.query.cards.findFirst({
    where: and(eq(cards.id, body.card_id), eq(cards.userId, session.user.id))
  })
  if (!card) return Response.json({ error: 'Not found' }, { status: 404 })

  // Write action to queue
  const [action] = await db.insert(actionQueue).values({
    userId: session.user.id,
    cardId: body.card_id,
    actionType: body.action_type,
    payload: body.payload,
    status: 'queued',
  }).returning()

  // Update card status
  await db.update(cards)
    .set({ status: 'approved', updatedAt: new Date() })
    .where(eq(cards.id, body.card_id))

  // Emit SSE event so UI updates immediately
  await emitSseEvent(session.user.id, 'card.updated', { ...card, status: 'approved' })

  return Response.json({ action_id: action.id })
}
```

### `emitSseEvent` helper

```typescript
// lib/sse.ts
import { db } from './db/client'
import { sseEvents } from './db/schema'

export async function emitSseEvent(
  userId: string,
  eventType: string,
  payload: unknown
) {
  await db.insert(sseEvents).values({ userId, eventType, payload })
}
```

The agent uses this same function (directly via Postgres insert) when it creates cards or marks them done.

---

## Triggers

### `GET /api/triggers`
### `POST /api/triggers`

**Body:**
```json
{
  "name": "Scan work email",
  "integration": "outlook",
  "category_id": "uuid",
  "schedule": "*/15 * * * *",
  "prompt_template": "…",
  "integration_config": {},
  "enabled": true
}
```

### `PATCH /api/triggers/:id`
### `DELETE /api/triggers/:id`
### `POST /api/triggers/:id/run`

Inserts a row into a `manual_run_requests` table (or a simple boolean flag on the trigger). The agent checks this on its next heartbeat and runs the trigger immediately.

---

## Categories

### `GET /api/categories`
### `POST /api/categories`
### `PATCH /api/categories/:id`
### `DELETE /api/categories/:id`

---

## Agent status

### `GET /api/agent/status`

```typescript
const [session] = await db
  .select()
  .from(agentSessions)
  .where(eq(agentSessions.userId, userId))
  .limit(1)

const secondsAgo = session
  ? Math.floor((Date.now() - new Date(session.lastSeen).getTime()) / 1000)
  : null

return Response.json({
  online: secondsAgo !== null && secondsAgo < 120,
  last_seen: session?.lastSeen ?? null,
  seconds_ago: secondsAgo,
  integrations: session?.integrations ?? [],
})
```

---

## Error format

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

Common codes: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`

---

## Zod schemas — `lib/schemas.ts`

```typescript
import { z } from 'zod'

export const CreateCardSchema = z.object({
  category_id: z.string().uuid(),
  title: z.string().min(1).max(500),
  summary: z.string().optional(),
  draft_reply: z.string().optional(),
})

export const CreateActionSchema = z.object({
  card_id: z.string().uuid(),
  action_type: z.enum(['reply_email', 'reply_teams', 'reply_github']),
  payload: z.record(z.unknown()),
})

export const CreateTriggerSchema = z.object({
  name: z.string().min(1),
  integration: z.enum(['outlook', 'teams', 'github']),
  category_id: z.string().uuid(),
  schedule: z.string(),
  prompt_template: z.string().min(1),
  integration_config: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
})
```

---

## Tasks checklist

- [ ] `lib/auth-guard.ts`
- [ ] `lib/db/client.ts` (Drizzle + postgres.js)
- [ ] `lib/db/schema.ts` (all tables)
- [ ] `lib/sse.ts` (emitSseEvent helper)
- [ ] `lib/schemas.ts` (Zod)
- [ ] `GET /api/sse` — SSE stream with 2s polling + keep-alive
- [ ] `GET /api/cards`, `POST`, `PATCH/:id`, `DELETE/:id`
- [ ] `POST /api/actions`
- [ ] `GET /api/triggers`, `POST`, `PATCH/:id`, `DELETE/:id`, `POST/:id/run`
- [ ] `GET /api/categories`, `POST`, `PATCH/:id`, `DELETE/:id`
- [ ] `GET /api/agent/status`
- [ ] Add `X-Accel-Buffering: no` to SSE response headers
