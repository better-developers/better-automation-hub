# 05 — Sync Layer

No Supabase, no reverse tunnel. Everything flows through Postgres on your Coolify VPS.

## Overview

| Direction | Mechanism | Latency |
|---|---|---|
| Agent → UI (new card) | Agent writes to `sse_events` → SSE endpoint polls every 2s | ~2–4s |
| Agent → UI (card done) | Same — SSE event on card update | ~2–4s |
| UI → Agent (send action) | API writes to `action_queue` → agent polls every 10s | ~10s |
| UI → Agent (config change) | Agent re-syncs triggers from DB every 2 min | ~2 min |
| UI → UI (agent online?) | UI polls `GET /api/agent/status` every 30s | 30s |

---

## SSE architecture

```
Browser                 Next.js                Postgres (VPS)        Local agent
  |                        |                        |                     |
  |── GET /api/sse ────────▶|                        |                     |
  |                        |── SELECT sse_events ──▶|                     |
  |                        |◀── (empty) ────────────|                     |
  |  (waiting…)            |                        |                     |
  |                        |                        |◀── INSERT card ─────|
  |                        |                        |◀── INSERT sse_event ─|
  |                        |── SELECT sse_events ──▶|                     |
  |                        |◀── (1 new row) ─────────|                     |
  |◀── event: card.created─|                        |                     |
  | (UI updates instantly) |                        |                     |
```

The SSE endpoint polls `sse_events` every 2 seconds using a cursor (`WHERE id > $lastId`). Rows older than 24 hours can be pruned with a cron job or Postgres `pg_cron`.

---

## Why not WebSockets or PostgreSQL LISTEN/NOTIFY?

- **WebSockets** require a stateful server — Next.js on Coolify with Docker restarts loses connections. SSE reconnects automatically.
- **LISTEN/NOTIFY** would be cleaner but Next.js App Router route handlers don't support long-lived async Postgres connections well. The `sse_events` table polling approach is explicit, debuggable, and works perfectly within Next.js's request model.
- **The 2s polling delay is acceptable** — email/Teams replies have no real-time requirement.

---

## SSE reconnection

`EventSource` in browsers auto-reconnects on disconnect. The `Last-Event-ID` header is sent automatically on reconnect:

```typescript
// The browser sends: Last-Event-ID: 1042
// The SSE endpoint reads it:
const lastId = parseInt(req.headers.get('Last-Event-ID') ?? '0')
```

Update the SSE route to read this header on connection, so reconnects don't replay all old events:

```typescript
const resumeFrom = parseInt(req.headers.get('last-event-id') ?? '0')
let lastId = resumeFrom || (await getMaxEventId(userId))
```

---

## Action queue — detailed timing

1. User clicks "Send" at T=0
2. `POST /api/actions` completes at T~=50ms (writes `action_queue` row + SSE event → card turns `approved` in UI)
3. Agent polls at T~=10s → picks up the queued action
4. Agent marks `processing`, calls MCP, marks `done` at T~=12–15s
5. Agent writes SSE event → card turns `done` in UI at T~=14–17s

For email/Teams, this delay is invisible. The user sees "Approved" immediately, then "Done" a few seconds later.

---

## Direct Postgres connection from local agent

The agent connects to Postgres on your VPS over the internet. Secure this:

1. **Use a strong password** — set in Coolify Postgres config
2. **Expose port 5432** on the VPS firewall, but restrict to your home IP:
   ```
   ufw allow from YOUR_HOME_IP to any port 5432
   ```
3. **Use SSL** — postgres.js enables SSL by default when connecting to non-localhost
4. **Consider SSH tunnel** if you prefer not to expose port 5432 at all:
   ```bash
   ssh -L 5432:localhost:5432 user@vps.yourdomain.com
   # Then agent uses DATABASE_URL=postgresql://...@localhost:5432/...
   ```

---

## SSE event cleanup

Add a daily job to prune old events (keep last 24h):

```sql
-- Run via pg_cron or a cron job in the agent
DELETE FROM sse_events WHERE created_at < now() - interval '24 hours';
```

In the agent's startup:

```typescript
// index.ts — run cleanup daily
setInterval(async () => {
  await db.execute(sql`DELETE FROM sse_events WHERE created_at < now() - interval '24 hours'`)
}, 24 * 60 * 60 * 1000)
```

---

## Traefik SSE configuration

Traefik buffers responses by default, which breaks SSE. The `X-Accel-Buffering: no` header in the Next.js SSE response handles this, but you can also add a Traefik middleware label to the Next.js service in Coolify:

```yaml
# In your Coolify service labels or docker-compose override
labels:
  - "traefik.http.middlewares.no-buffer.headers.customresponseheaders.X-Accel-Buffering=no"
```

Test SSE is working:
```bash
curl -N https://your-app.yourdomain.com/api/sse \
  -H "Cookie: next-auth.session-token=..."
# Should stream: : keep-alive  every 25s
```
