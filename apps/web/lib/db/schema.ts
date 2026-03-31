import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  pgEnum,
  unique,
  bigint,
  uuid,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const cardStatusEnum = pgEnum('card_status', [
  'pending',
  'reviewed',
  'approved',
  'sending',
  'done',
  'dismissed',
])

export const actionStatusEnum = pgEnum('action_status', [
  'queued',
  'processing',
  'done',
  'failed',
])

export const integrationEnum = pgEnum('integration', [
  'outlook',
  'teams',
  'github',
])

// ---------------------------------------------------------------------------
// BetterAuth tables — column names MUST NOT be changed
// id is text (cuid2) not uuid — BetterAuth generates its own IDs
// ---------------------------------------------------------------------------

export const authUsers = pgTable('auth_users', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  email:         text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image:         text('image'),
  createdAt:     timestamp('created_at').notNull(),
  updatedAt:     timestamp('updated_at').notNull(),
})

export const authAccounts = pgTable('auth_accounts', {
  id:                    text('id').primaryKey(),
  accountId:             text('account_id').notNull(),
  providerId:            text('provider_id').notNull(),
  userId:                text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  accessToken:           text('access_token'),
  refreshToken:          text('refresh_token'),
  idToken:               text('id_token'),
  accessTokenExpiresAt:  timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             timestamp('created_at').notNull(),
  updatedAt:             timestamp('updated_at').notNull(),
})

// ---------------------------------------------------------------------------
// App tables
// users.id mirrors authUsers.id — same text (cuid2) value
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id:        text('id').primaryKey(),
  email:     text('email').notNull().unique(),
  name:      text('name').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const categories = pgTable('categories', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  color:     text('color').notNull().default('#6366f1'),
  position:  integer('position').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const cards = pgTable('cards', {
  id:              uuid('id').primaryKey().defaultRandom(),
  userId:          text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId:      uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  triggerId:       uuid('trigger_id'),
  title:           text('title').notNull(),
  summary:         text('summary'),
  originalContent: jsonb('original_content'),
  draftReply:      text('draft_reply'),
  status:          cardStatusEnum('status').notNull().default('pending'),
  actionType:      text('action_type'),
  actionMetadata:  jsonb('action_metadata'),
  position:        integer('position').notNull().default(0),
  snoozedUntil:    timestamp('snoozed_until'),
  createdAt:       timestamp('created_at').defaultNow().notNull(),
  updatedAt:       timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Phase 3+ tables — defined now to avoid future breaking migrations
// ---------------------------------------------------------------------------

export const triggers = pgTable('triggers', {
  id:                uuid('id').primaryKey().defaultRandom(),
  userId:            text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  categoryId:        uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  name:              text('name').notNull(),
  integration:       integrationEnum('integration').notNull(),
  schedule:          text('schedule').notNull().default('*/15 * * * *'),
  promptTemplate:    text('prompt_template').notNull(),
  integrationConfig: jsonb('integration_config').default({}),
  enabled:           boolean('enabled').notNull().default(true),
  lastRunAt:         timestamp('last_run_at'),
  createdAt:         timestamp('created_at').defaultNow().notNull(),
})

export const manualRunRequests = pgTable('manual_run_requests', {
  id:          uuid('id').primaryKey().defaultRandom(),
  triggerId:   uuid('trigger_id').notNull().references(() => triggers.id, { onDelete: 'cascade' }),
  userId:      text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
})

export const actionQueue = pgTable('action_queue', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  cardId:      uuid('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  actionType:  text('action_type').notNull(),
  payload:     jsonb('payload').notNull(),
  status:      actionStatusEnum('status').notNull().default('queued'),
  error:       text('error'),
  createdAt:   timestamp('created_at').defaultNow().notNull(),
  processedAt: timestamp('processed_at'),
})

export const processedItems = pgTable('processed_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integration: integrationEnum('integration').notNull(),
  externalId:  text('external_id').notNull(),
  processedAt: timestamp('processed_at').defaultNow().notNull(),
}, (t) => ({
  uniq: unique().on(t.userId, t.integration, t.externalId),
}))

export const agentSessions = pgTable('agent_sessions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  lastSeen:     timestamp('last_seen').defaultNow().notNull(),
  version:      text('version'),
  integrations: text('integrations').array(),
})

export const sseEvents = pgTable('sse_events', {
  id:        bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload:   jsonb('payload').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
