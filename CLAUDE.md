# CLAUDE.md — Better Automation Hub

Personal automation system: a hosted Kanban UI where cards are created automatically by a local Claude agent that monitors Outlook, Teams, and GitHub via MCP servers.

---

## Repo layout

```
better-ai-agents/                  ← git root (this file lives here)
├── apps/
│   └── web/                       ← Next.js 14 App Router (frontend + API)
│       ├── app/
│       │   ├── board/             ← Kanban UI (/board)
│       │   ├── config/            ← Trigger + category management (/config)
│       │   ├── login/             ← Microsoft sign-in page
│       │   └── api/               ← REST + SSE endpoints
│       ├── lib/
│       │   ├── db/
│       │   │   ├── client.ts      ← Drizzle + postgres.js
│       │   │   └── schema.ts      ← All Drizzle table definitions
│       │   ├── auth.ts            ← BetterAuth config
│       │   ├── auth-client.ts     ← Browser-side BetterAuth client
│       │   ├── auth-guard.ts      ← requireSession() helper for API routes
│       │   ├── sse.ts             ← emitSseEvent() helper
│       │   └── schemas.ts         ← Zod validation schemas
│       ├── middleware.ts           ← Auth protection for all routes
│       └── components/
├── packages/
│   └── agent/                     ← Local Node.js agent (runs on dev machine)
│       ├── src/
│       │   ├── index.ts
│       │   ├── db.ts              ← Drizzle (imports shared schema from apps/web)
│       │   ├── heartbeat.ts
│       │   ├── scheduler.ts
│       │   ├── trigger-runner.ts
│       │   ├── claude-runner.ts
│       │   ├── action-watcher.ts
│       │   ├── sse.ts
│       │   └── integrations/
│       │       ├── index.ts       ← FetchedItem interface + registry
│       │       ├── outlook.ts
│       │       ├── teams.ts
│       │       └── github.ts
│       └── .env
├── drizzle/
│   └── migrations/                ← Generated SQL migrations
├── drizzle.config.ts
└── tasks/                         ← Implementation plan docs (reference only)
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router, TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | TanStack Query v5 |
| Drag-and-drop | @hello-pangea/dnd |
| Auth | BetterAuth (JWT sessions, Microsoft Entra ID multi-tenant) |
| Database | Postgres (on Coolify VPS), Drizzle ORM, postgres.js |
| Realtime | Server-Sent Events — `sse_events` table polled every 2s |
| Local agent | Node.js process, tsx for dev |
| Claude | @anthropic-ai/sdk, MCP servers passed as tools |
| Deploy | Coolify + Nixpacks (Docker), Traefik reverse proxy |

---

## Database schema (Drizzle — `apps/web/lib/db/schema.ts`)

All tables live in `lib/db/schema.ts`. The agent imports this same file — never duplicate type definitions.

### Enums
- `card_status`: `pending | reviewed | approved | sending | done | dismissed`
- `action_status`: `queued | processing | done | failed`
- `integration`: `outlook | teams | github`

### Tables

| Table | Purpose |
|---|---|
| `auth_users` | BetterAuth-managed user rows (do not rename columns) |
| `auth_accounts` | BetterAuth OAuth accounts — stores MS access_token + refresh_token |
| `users` | App users, one row per login, `id` matches `auth_users.id` |
| `categories` | Kanban columns (name, color, position, userId FK) |
| `triggers` | Automation rules (integration, cron schedule, promptTemplate, integrationConfig JSON) |
| `cards` | Kanban cards — title, summary, originalContent, draftReply, status, actionMetadata |
| `action_queue` | User-approved actions waiting for agent execution |
| `processed_items` | Deduplication — (userId, integration, externalId) unique constraint |
| `agent_sessions` | One row per userId — agent writes lastSeen every 30s |
| `sse_events` | Append-only event log; Next.js SSE tails this; prune rows > 24h |

Key indexes (add after migration):
```sql
CREATE INDEX cards_user_status   ON cards(user_id, status);
CREATE INDEX cards_category      ON cards(category_id, position);
CREATE INDEX action_queue_status ON action_queue(user_id, status) WHERE status = 'queued';
CREATE INDEX sse_events_user     ON sse_events(user_id, id);
```

---

## Authentication (BetterAuth + Microsoft Entra ID)

- **JWT sessions** — no `auth_sessions` table, cookie-based JWT signed with `BETTER_AUTH_SECRET`
- **Multi-tenant** — `tenantId: 'common'` allows any Microsoft account to attempt login
- **Email allowlist** — `ALLOWED_EMAILS` env var (comma-separated) is the only gate
- `auth_users.id` == `users.id` == Entra object ID — same UUID everywhere
- The stored `auth_accounts.access_token` is reused by the agent to authenticate MCP server calls (avoids separate MS credential flow)

### Key files
- `lib/auth.ts` — BetterAuth config, JWT strategy, signIn callback (allowlist + upsert into `users`)
- `lib/auth-client.ts` — `createAuthClient` for browser, exports `signIn`, `signOut`, `useSession`
- `lib/auth-guard.ts` — `requireSession()` called at top of every API route handler
- `middleware.ts` — redirects unauthenticated requests to `/login`, skips `/api/auth/*` and `/login`
- `app/login/page.tsx` — single "Sign in with Microsoft" button calling `signIn.social({ provider: 'microsoft', callbackURL: '/board' })`
- `app/api/auth/[...all]/route.ts` — `toNextJsHandler(auth)` (GET + POST)

---

## Realtime — SSE architecture

```
Browser → GET /api/sse (persistent stream)
Next.js  → polls sse_events WHERE id > $lastId every 2s
Agent    → INSERT into sse_events when cards are created/updated
Next.js  → pushes new rows as SSE messages to browser
Browser  → updates TanStack Query cache (no page refresh)
```

**Critical headers on SSE response:**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no   ← disables Traefik/Nginx proxy buffering
```

SSE reconnect: read `Last-Event-ID` header on reconnect to resume from correct cursor, not replay all events.

Keep-alive comment (`: keep-alive`) every 25s to prevent proxy timeouts.

**`lib/sse.ts`** — `emitSseEvent(userId, eventType, payload)` inserts into `sse_events`. Used by both API routes and the agent.

---

## REST API routes (`apps/web/app/api/`)

Every route calls `requireSession()` first. Returns `{ error, code }` on failure.

| Route | Method | Purpose |
|---|---|---|
| `/api/sse` | GET | SSE stream — realtime card updates |
| `/api/agent/status` | GET | Returns `{ online, last_seen, seconds_ago, integrations }` — online if lastSeen < 120s ago |
| `/api/cards` | GET | All cards for user, supports `?status=` and `?category_id=` filters |
| `/api/cards` | POST | Manual card creation from UI |
| `/api/cards/:id` | PATCH | Update category, position, status, draft_reply, snoozed_until |
| `/api/cards/:id` | DELETE | Hard delete (prefer status=dismissed) |
| `/api/actions` | POST | Write to action_queue + update card to `approved` + emit SSE event |
| `/api/categories` | GET/POST | List / create categories |
| `/api/categories/:id` | PATCH/DELETE | Update / delete (block if has cards) |
| `/api/triggers` | GET/POST | List / create triggers |
| `/api/triggers/:id` | PATCH/DELETE | Update / delete |
| `/api/triggers/:id/run` | POST | Insert `manual_run_requests` row for immediate agent pickup |
| `/api/auth/[...all]` | GET/POST | BetterAuth handler |

Zod schemas in `lib/schemas.ts`: `CreateCardSchema`, `CreateActionSchema`, `CreateTriggerSchema`, `PatchCardSchema`.

---

## Kanban UI

### Pages
- `/` → redirect to `/board`
- `/board` — Kanban view + SSE subscription
- `/board/[cardId]` — URL-addressable card detail (sheet overlay)
- `/config` — Categories + Triggers tabs
- `/config/triggers/new` and `/config/triggers/[id]`
- `/login` — Microsoft sign-in

### Component tree (key parts)
```
<RootLayout>
  <Providers>                        ← TanStack Query + BetterAuth
    <BoardPage>
      <BoardHeader>                  ← Title + AgentStatusBadge
      <KanbanBoard>                  ← SSE subscription, horizontal scroll
        <KanbanColumn> × N           ← Droppable, card count, snoozed badge
          <CardItem> × N             ← Compact face: icon, title, excerpt, status badge
      <CardDetailSheet>              ← Right-side Sheet (shadcn)
        <OriginalContent>            ← Collapsible accordion
        <DraftEditor>                ← Textarea pre-filled with draft_reply
        <CardActions>                ← Send / Dismiss / Move / Snooze
    <ConfigPage>
      <CategoryList>                 ← Inline edit, colour picker, drag-reorder
      <TriggerList>                  ← Toggle, edit, last-run time
      <TriggerForm>                  ← All fields + conditional integration config
```

### CardItem status badge colors
`pending`=amber, `reviewed`=blue, `approved`=purple, `sending`=yellow, `done`=green, `dismissed`=gray

### AgentStatusBadge
Polls `GET /api/agent/status` every 30s. Shows "● Online" (green) or "● Offline" (red). Popover shows active integrations.

### Snoozed cards
Filter client-side: `cards.filter(c => !c.snoozed_until || new Date(c.snoozed_until) < new Date())`.
Column header shows count badge for hidden snoozed cards.

### Drag-and-drop
`@hello-pangea/dnd` — dragging between columns calls `PATCH /api/cards/:id` with new `category_id`.

---

## Local agent (`packages/agent/`)

Runs as a long-lived Node.js process on the developer's machine. Connects directly to Postgres on the VPS.

### Responsibilities
1. **Heartbeat** — upserts `agent_sessions` every 30s
2. **Trigger sync** — loads enabled triggers from DB, re-syncs every 2 min
3. **Scheduler** — `node-cron` job per trigger
4. **Claude runner** — Claude API call with MCP servers, structured JSON response
5. **Card writer** — INSERT card + SSE event directly into Postgres
6. **Action watcher** — polls `action_queue` every 10s, executes via MCP
7. **Startup cleanup** — resets stuck `processing` actions older than 5 min

### `src/db.ts`
Imports the **shared schema** from `../../apps/web/lib/db/schema`. Never duplicate schema definitions.

### `src/claude-runner.ts`
Calls `client.messages.create()` with `mcp_servers` array. Expects Claude to return JSON: `{ title, reply, summary }`. Falls back gracefully if response is plain text. Supports array responses (multiple items per run) for batch triggers.

### `src/trigger-runner.ts`
1. Call `integration.fetchNew(trigger)` → `FetchedItem[]`
2. Filter already-processed `externalId`s via `processed_items` table
3. For each new item: `runClaude(...)` → insert card + SSE event → insert `processed_items`
4. Update `trigger.lastRunAt`

### `src/action-watcher.ts`
1. Poll `action_queue WHERE status='queued'` every 10s (limit 5)
2. Mark `processing`, call `integration.execute(payload)`
3. On success: mark `done`, update card `status='done'`, emit SSE event
4. On failure: mark `failed`, revert card to `pending`, store error message

### Integration interface (`src/integrations/index.ts`)
```typescript
interface FetchedItem {
  externalId: string           // deduplication key
  templateVars: Record<string, string>
  raw: unknown                 // stored as originalContent on card
  actionMetadata: unknown      // message_id, thread_id, etc.
}

interface Integration {
  fetchNew(trigger: Trigger): Promise<FetchedItem[]>
  execute(payload: Record<string, unknown>): Promise<void>
  mcpServers: McpServerConfig[]
  actionType: string           // 'reply_email' | 'reply_teams' | 'reply_github'
}
```

---

## Integrations

### Outlook (`src/integrations/outlook.ts`)
- MCP server: `npx @softeria/ms-365-mcp-server --transport sse --port 3001`
- Exposed via Cloudflare tunnel → `MS365_MCP_URL`
- `fetchNew`: list unread emails via MCP, return as FetchedItem array
- `execute`: send reply via MCP using `message_id` + `thread_id` from actionMetadata
- Token: read `auth_accounts.access_token` for the user from Postgres

### Teams (`src/integrations/teams.ts`)
- Same ms-365-mcp-server instance as Outlook
- `integrationConfig` holds `team_id` + `channel_id`
- `fetchNew`: list new channel messages since last run
- `execute`: post reply to thread via MCP

### GitHub (`src/integrations/github.ts`)
- MCP server: GitHub Copilot MCP or self-hosted → `GITHUB_MCP_URL`
- Auth: fine-grained PAT → `GITHUB_TOKEN`
- `integrationConfig` holds `owner`, `repo`, watch event types (`issues`, `prs`, `pr_comments`, `mentions`)
- `fetchNew`: poll REST API for new events since `lastRunAt`, filter by watched event types
- `execute`: add comment via MCP

---

## Prompt template variables

| Variable | Available in |
|---|---|
| `{{content}}` | All integrations |
| `{{subject}}` | Outlook |
| `{{from}}` | Outlook |
| `{{date}}` | All |
| `{{thread_id}}` | Outlook, Teams |
| `{{channel}}` | Teams |
| `{{team}}` | Teams |
| `{{repo}}` | GitHub |
| `{{issue_title}}` | GitHub |
| `{{author}}` | GitHub |
| `{{event_type}}` | GitHub |

Claude must respond with JSON: `{ "title": "...", "reply": "...", "summary": "..." }` (or an array of these for batch triggers).

---

## Environment variables

### `apps/web/.env.local`
```env
DATABASE_URL=postgresql://user:password@vps.yourdomain.com:5432/automation_hub
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=https://your-app.yourdomain.com
NEXT_PUBLIC_APP_URL=https://your-app.yourdomain.com
ENTRA_CLIENT_ID=<Application (client) ID from portal.azure.com>
ENTRA_CLIENT_SECRET=<Client secret value>
ALLOWED_EMAILS=casper@betterdevelopers.dk
```

### `packages/agent/.env`
```env
DATABASE_URL=postgresql://user:password@vps.yourdomain.com:5432/automation_hub
ANTHROPIC_API_KEY=sk-ant-...
AGENT_USER_ID=<uuid from users table — set after first login>
ACTIVE_INTEGRATIONS=outlook,teams,github
GITHUB_TOKEN=github_pat_...
MS365_MCP_URL=https://your-tunnel.yourdomain.com/mcp
GITHUB_MCP_URL=https://...
```

---

## Deployment (Coolify — already set up)

- Next.js service: `output: 'standalone'` in `next.config.ts`, `nixpacks.toml` configured
- `DATABASE_URL` and all auth env vars set in Coolify service env
- Migrations: `npx drizzle-kit migrate` (run manually after each schema change or via GitHub Actions deploy workflow)
- Traefik: `X-Accel-Buffering: no` header on SSE route is sufficient — no extra Traefik label needed
- Agent: runs locally via `npm run dev` in `packages/agent`; launchd plist for auto-start on machine login (Phase 6)

### `drizzle.config.ts` (repo root)
```typescript
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './apps/web/lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

---

## Implementation phases

Work through these in order. Each phase is independently deployable.

### Phase 1 — Skeleton (current target)
Goal: deployed app, login works, board shows categories, cards can be created manually.

Checklist:
- [ ] `npx create-next-app@latest apps/web --typescript --tailwind --app`
- [ ] Install: `drizzle-orm postgres drizzle-kit better-auth @tanstack/react-query @hello-pangea/dnd shadcn-ui date-fns react-hook-form zod`
- [ ] `lib/db/schema.ts` — all tables including BetterAuth tables
- [ ] `drizzle.config.ts` at repo root
- [ ] `npx drizzle-kit generate && npx drizzle-kit migrate`
- [ ] `lib/auth.ts`, `lib/auth-client.ts`, `lib/auth-guard.ts`, `middleware.ts`
- [ ] `app/api/auth/[...all]/route.ts`
- [ ] `app/login/page.tsx`
- [ ] `GET/POST /api/categories`, `GET/POST/PATCH /api/cards`
- [ ] React Query provider in root layout
- [ ] `BoardPage` + `KanbanBoard` + `KanbanColumn` + `CardItem` + `CardDetailSheet`
- [ ] Drag-and-drop between columns
- [ ] Deploy to Coolify, verify login + board

### Phase 2 — SSE + agent heartbeat
- [ ] `agent_sessions` + `sse_events` tables + migration
- [ ] `lib/sse.ts` (`emitSseEvent`)
- [ ] `GET /api/sse` + `GET /api/agent/status`
- [ ] `packages/agent/` — init package, `src/db.ts`, `src/heartbeat.ts`, `src/index.ts`
- [ ] `AgentStatusBadge` component
- [ ] SSE subscription in `KanbanBoard` → updates Query cache

### Phase 3 — Config UI + trigger management
- [ ] `triggers` + `manual_run_requests` tables + migration
- [ ] Full CRUD for `/api/triggers` and `/api/categories`
- [ ] `POST /api/triggers/:id/run`
- [ ] `src/scheduler.ts` in agent (cron management, re-sync every 2 min)
- [ ] Agent checks `manual_run_requests` on heartbeat
- [ ] `/config` page — CategoryList, TriggerList, TriggerForm

### Phase 4 — Outlook end-to-end
- [ ] `action_queue` + `processed_items` tables + migration
- [ ] `POST /api/actions`
- [ ] `src/claude-runner.ts`, `src/trigger-runner.ts`, `src/action-watcher.ts`
- [ ] `src/integrations/outlook.ts`
- [ ] ms-365-mcp-server running in SSE mode + Cloudflare tunnel active
- [ ] Send button in `CardDetailSheet`

### Phase 5 — Teams + GitHub
- [ ] `src/integrations/teams.ts` + `src/integrations/github.ts`
- [ ] Integration registry in `src/integrations/index.ts`
- [ ] GitHub fine-grained PAT configured

### Phase 6 — Polish
- [ ] Loading skeletons, toast notifications (Sonner), empty states
- [ ] Snooze: date picker, filter, badge
- [ ] Mobile layout
- [ ] Error badge on failed actions
- [ ] SSE event cleanup (prune > 24h daily)
- [ ] launchd plist for agent auto-start

---

## Key constraints and decisions

- **No Supabase** — SSE polling on `sse_events` table is intentional (simpler, debuggable)
- **No WebSockets** — SSE reconnects automatically; WebSockets lose state on Docker restart
- **Agent writes directly to Postgres** — no HTTP API between agent and web app
- **Shared schema** — agent imports `apps/web/lib/db/schema.ts`; never duplicate table definitions
- **BetterAuth JWT** — no session table; `auth_users.id` == `users.id` == Entra object ID
- **MS token reuse** — agent reads `auth_accounts.access_token` from DB; user must be logged in via web app first
- **Email allowlist** gates access even though Entra is multi-tenant

---

## GitHub issues (tracking phases)

| Issue | Phase |
|---|---|
| #1 | Phase 1 — Skeleton |
| #2 | Phase 2 — SSE + agent heartbeat |
| #3 | Phase 3 — Config UI + trigger management |
| #4 | Phase 4 — Outlook end-to-end |
| #5 | Phase 5 — Teams + GitHub |
| #6 | Phase 6 — Polish |
