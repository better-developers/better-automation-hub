# 01 — Database (Postgres on Coolify + Drizzle ORM)

## Setup on Coolify

1. In Coolify → New Resource → PostgreSQL
2. Set a strong password, note the internal host (e.g. `postgres-automation:5432`)
3. The Next.js app and the local agent both connect to this Postgres instance
4. Expose port 5432 externally on the VPS firewall **only** if the local agent needs to reach it from your machine (see `05-sync.md`)

---

## Drizzle setup in Next.js app

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

### `lib/db/client.ts`

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL!

// For Next.js: prevent multiple connections in dev (hot reload)
const globalForDb = global as unknown as { pgClient: ReturnType<typeof postgres> }
const pgClient = globalForDb.pgClient ?? postgres(connectionString)
if (process.env.NODE_ENV !== 'production') globalForDb.pgClient = pgClient

export const db = drizzle(pgClient, { schema })
```

### `lib/db/schema.ts`

```typescript
import {
  pgTable, uuid, text, integer, boolean, jsonb,
  timestamp, pgEnum, unique
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Enums ───────────────────────────────────────────────────────────────────

export const cardStatusEnum = pgEnum('card_status', [
  'pending', 'reviewed', 'approved', 'sending', 'done', 'dismissed'
])

export const actionStatusEnum = pgEnum('action_status', [
  'queued', 'processing', 'done', 'failed'
])

export const integrationEnum = pgEnum('integration', [
  'outlook', 'teams', 'github'
])

// ─── Users ───────────────────────────────────────────────────────────────────
// One row per NextAuth user. Created on first login.

export const users = pgTable('users', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull().unique(),
  name:      text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ─── Categories ──────────────────────────────────────────────────────────────

export const categories = pgTable('categories', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  color:     text('color').notNull().default('#6366f1'),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ─── Triggers ────────────────────────────────────────────────────────────────

export const triggers = pgTable('triggers', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  userId:             uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId:         uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  name:               text('name').notNull(),
  integration:        integrationEnum('integration').notNull(),
  schedule:           text('schedule').notNull().default('*/15 * * * *'),
  promptTemplate:     text('prompt_template').notNull(),
  integrationConfig:  jsonb('integration_config').default({}),  // teams channel, github repo, etc.
  enabled:            boolean('enabled').notNull().default(true),
  lastRunAt:          timestamp('last_run_at'),
  createdAt:          timestamp('created_at').defaultNow().notNull(),
})

// ─── Cards ───────────────────────────────────────────────────────────────────

export const cards = pgTable('cards', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId:      uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  triggerId:       uuid('trigger_id').references(() => triggers.id, { onDelete: 'set null' }),

  title:           text('title').notNull(),
  summary:         text('summary'),                // short excerpt shown on card face
  originalContent: jsonb('original_content'),      // raw source object
  draftReply:      text('draft_reply'),            // Claude's editable draft

  status:          cardStatusEnum('status').notNull().default('pending'),
  actionType:      text('action_type'),            // 'reply_email' | 'reply_teams' | 'reply_github'
  actionMetadata:  jsonb('action_metadata'),       // message_id, thread_id, etc.

  position:        integer('position').notNull().default(0),
  snoozedUntil:    timestamp('snoozed_until'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
})

// ─── Action queue ─────────────────────────────────────────────────────────────
// Written by the API when user clicks Send. Polled by the local agent.

export const actionQueue = pgTable('action_queue', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId:      uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  actionType:  text('action_type').notNull(),
  payload:     jsonb('payload').notNull(),
  status:      actionStatusEnum('status').notNull().default('queued'),
  error:       text('error'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
})

// ─── Agent sessions ───────────────────────────────────────────────────────────

export const agentSessions = pgTable('agent_sessions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  lastSeen:     timestamp('last_seen').defaultNow().notNull(),
  version:      text('version'),
  integrations: text('integrations').array(),
})

// ─── Processed items (deduplication) ─────────────────────────────────────────

export const processedItems = pgTable('processed_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integration: integrationEnum('integration').notNull(),
  externalId:  text('external_id').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.userId, t.integration, t.externalId),
}))

// ─── SSE event log ────────────────────────────────────────────────────────────
// The agent writes SSE events here; the Next.js SSE endpoint tails this table.

export const sseEvents = pgTable('sse_events', {
  id:        bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),   // 'card.created' | 'card.updated'
  payload:   jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

---

## Migrations

```bash
# Generate migration from schema
npx drizzle-kit generate

# Apply to database
npx drizzle-kit migrate
```

### `drizzle.config.ts`

```typescript
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './apps/web/lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

---

## Indexes (add to schema or as raw SQL after migration)

```sql
CREATE INDEX cards_user_status   ON cards(user_id, status);
CREATE INDEX cards_category      ON cards(category_id, position);
CREATE INDEX action_queue_status ON action_queue(user_id, status) WHERE status = 'queued';
CREATE INDEX sse_events_user     ON sse_events(user_id, id);
```

---

## Environment variables

```env
# DATABASE_URL format for Postgres
DATABASE_URL=postgresql://user:password@your-vps-host:5432/automation_hub

# For local agent connecting from your machine (same URL, publicly exposed port)
DATABASE_URL=postgresql://user:password@vps.yourdomain.com:5432/automation_hub
```

---

## SSE event log — why a table?

Without Supabase Realtime, we need a way for the local agent (which writes directly to Postgres) to notify the browser. The pattern:

1. Agent writes a card → also inserts a row to `sse_events`
2. Next.js SSE endpoint does `SELECT ... WHERE id > $lastSeenId` every 2 seconds
3. New rows are pushed to the browser as SSE messages
4. The browser updates its React Query cache

This is a lightweight "poor man's pub/sub" using Postgres — no Redis, no websocket server needed. See `05-sync.md` for the full SSE implementation.

---

## Coolify setup checklist

- [ ] Create PostgreSQL resource in Coolify
- [ ] Note internal hostname + port (for Next.js Docker container, same network)
- [ ] Note external hostname + port (for local agent on your machine)
- [ ] Restrict external port to your home IP in VPS firewall if possible
- [ ] Create database `automation_hub`
- [ ] Set `DATABASE_URL` in Coolify env vars for the Next.js service
- [ ] Run migrations: `npx drizzle-kit migrate` (from CI or manually after first deploy)
