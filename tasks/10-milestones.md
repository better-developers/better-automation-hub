# 10 — Milestones

Each phase is independently deployable and useful on its own. Build in order — each phase unblocks the next.

---

## Phase 1 — Skeleton (2 days)

Goal: deployed app, can log in, create cards manually, see them on the board.

### Acceptance criteria
- [ ] Can log in with GitHub (only your account accepted)
- [ ] Board shows at least 2 hardcoded categories
- [ ] Can create a card manually from the UI
- [ ] Card detail sheet opens, draft editable, dismiss works
- [ ] Deployed on Coolify and reachable over HTTPS

### Tasks

**DB**
- [ ] Postgres service on Coolify
- [ ] Drizzle schema — `users`, `categories`, `cards`
- [ ] Run migration

**Auth**
- [ ] NextAuth v5 + GitHub + allowlist callback
- [ ] Upsert user on login
- [ ] Middleware protects all routes

**API**
- [ ] `GET /api/categories`
- [ ] `GET /api/cards`
- [ ] `POST /api/cards`
- [ ] `PATCH /api/cards/:id`

**UI**
- [ ] React Query provider
- [ ] `BoardPage` + `KanbanBoard` + `KanbanColumn` (no drag yet)
- [ ] `CardItem` compact face
- [ ] `CardDetailSheet` with draft editor + dismiss
- [ ] Drag-and-drop between columns

---

## Phase 2 — SSE + agent heartbeat (1–2 days)

Goal: agent runs locally, shows Online in the board header, SSE pushes updates to the browser.

### Acceptance criteria
- [ ] Agent process starts, writes heartbeat every 30s
- [ ] Board header shows "● Online" within 30s of agent starting
- [ ] Creating a card via direct Postgres insert (agent simulation) appears in the board within 3s — no page refresh

### Tasks

**DB**
- [ ] `agent_sessions` table + migration
- [ ] `sse_events` table + migration

**API**
- [ ] `GET /api/agent/status`
- [ ] `GET /api/sse` — SSE endpoint with 2s polling + keep-alive
- [ ] `X-Accel-Buffering: no` header verified working through Traefik

**Agent**
- [ ] Agent package init + `src/db.ts` (direct Postgres)
- [ ] `src/heartbeat.ts`
- [ ] `src/index.ts` startup

**UI**
- [ ] `AgentStatusBadge` component + 30s polling
- [ ] SSE subscription in `KanbanBoard` → updates React Query cache
- [ ] Test: manually insert SSE event to Postgres → confirm card appears in UI

---

## Phase 3 — Config UI + trigger management (1–2 days)

Goal: can create and manage triggers + categories from the UI. Agent picks up config changes.

### Acceptance criteria
- [ ] Can create/edit/delete categories (name, colour, order)
- [ ] Can create a trigger (Outlook, Teams, or GitHub) with prompt template
- [ ] Enabling/disabling a trigger in the UI takes effect in the agent within 2 minutes
- [ ] "Run now" button fires the trigger within 30s

### Tasks

**DB**
- [ ] `triggers` table + `manual_run_requests` table + migration

**API**
- [ ] Full CRUD for `/api/categories`
- [ ] Full CRUD for `/api/triggers`
- [ ] `POST /api/triggers/:id/run`

**Agent**
- [ ] `src/scheduler.ts` — load triggers, cron jobs, re-sync every 2 min
- [ ] Check `manual_run_requests` on heartbeat

**UI**
- [ ] `/config` page with Categories + Triggers tabs
- [ ] Category CRUD (inline edit, colour picker, reorder)
- [ ] Trigger list with enable/disable toggle
- [ ] `TriggerForm` — all fields, cron presets, prompt textarea, variable hints
- [ ] Conditional fields: Teams (team_id/channel_id), GitHub (repo + watch events)
- [ ] "Run now" button

---

## Phase 4 — Outlook end-to-end (2 days)

Goal: Outlook emails become cards automatically. You can reply from the UI.

### Acceptance criteria
- [ ] New Outlook email → card appears in board within 15–20 minutes (or immediately on "Run now")
- [ ] Card shows original email + Claude's draft reply
- [ ] Edit draft → click Send → email is sent within 15s
- [ ] Card moves to Done
- [ ] Same email does not produce duplicate cards on next run

### Tasks

**DB**
- [ ] `action_queue` table + `processed_items` table + migration

**API**
- [ ] `POST /api/actions` — write action queue + emit SSE event

**Agent**
- [ ] `src/claude-runner.ts` — Claude API + MCP + JSON extraction + array handling
- [ ] `src/trigger-runner.ts` — JSON array loop, deduplicate by `external_id`, write cards + SSE
- [ ] `src/action-watcher.ts` — poll + execute + cleanup stuck actions
- [ ] `src/integrations/outlook.ts`
- [ ] ms-365-mcp-server running in SSE mode + tunnel active

**UI**
- [ ] Send button in `CardDetailSheet`
- [ ] Card status badges update in real-time: pending → approved → done

---

## Phase 5 — Teams + GitHub (2 days)

Goal: all 3 v1 integrations working.

### Tasks

- [ ] `src/integrations/teams.ts`
- [ ] `src/integrations/github.ts`
- [ ] Test Teams: message in watched channel → card → reply sent
- [ ] Test GitHub: new issue in watched repo → card → comment posted
- [ ] GitHub watch events: issues, PRs, PR comments, mentions all produce cards

---

## Phase 6 — Polish (1 day)

- [ ] Loading skeletons on board initial load
- [ ] Toast notifications (Sonner): sent, dismissed, error
- [ ] Snooze: date picker, filter from view, snoozed count badge
- [ ] Empty state per column ("No cards yet — triggers will populate this")
- [ ] Mobile layout (stacked columns, full-screen card detail)
- [ ] Agent error on card: failed actions shown as error badge with message
- [ ] SSE event cleanup (prune >24h rows daily)
- [ ] launchd auto-start tested after machine restart

---

## Total estimate

| Phase | Days |
|---|---|
| 1 — Skeleton + deploy | 2 |
| 2 — SSE + heartbeat | 1–2 |
| 3 — Config UI + triggers | 1–2 |
| 4 — Outlook end-to-end | 2 |
| 5 — Teams + GitHub | 2 |
| 6 — Polish | 1 |
| **Total** | **9–11 days** |

---

## Suggested file creation order

```
1.  supabase/ → drizzle/migrations/ — schema first, migrate before anything else
2.  apps/web/lib/db/schema.ts + client.ts
3.  apps/web/lib/auth.ts + middleware.ts
4.  apps/web/app/api/categories/ + cards/ routes
5.  apps/web/app/board/ — KanbanBoard (static, no SSE yet)
6.  → Deploy to Coolify, verify login + board works ←
7.  apps/web/app/api/sse/route.ts
8.  packages/agent/src/db.ts + heartbeat.ts + index.ts
9.  apps/web/app/api/agent/status/route.ts
10. AgentStatusBadge + SSE subscription in KanbanBoard
11. apps/web/app/api/triggers/ + config/ UI
12. packages/agent/src/scheduler.ts
13. packages/agent/src/claude-runner.ts
14. packages/agent/src/trigger-runner.ts
15. apps/web/app/api/actions/route.ts
16. packages/agent/src/action-watcher.ts
17. packages/agent/src/integrations/outlook.ts
    → Test Outlook end-to-end ←
18. packages/agent/src/integrations/teams.ts
19. packages/agent/src/integrations/github.ts
20. Polish pass
```
