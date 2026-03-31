# 04 — Local Node Agent

The agent is a long-running Node.js process on your machine. It connects directly to Postgres on your VPS, polls integrations via MCP + Claude API, and executes send actions.

---

## Responsibilities

1. **Heartbeat** — writes to `agent_sessions` every 30s
2. **Trigger sync** — loads enabled triggers from Postgres, re-syncs every 2 min
3. **Scheduler** — runs each trigger on its cron schedule
4. **Claude runner** — calls Claude API with prompt template + MCP server, gets draft reply
5. **Card writer** — inserts card + SSE event directly into Postgres
6. **Action executor** — polls `action_queue` every 10s, executes sends via MCP
7. **Startup cleanup** — resets stuck `processing` actions from previous crashes

---

## Project structure

```
packages/agent/
├── src/
│   ├── index.ts              ← startup sequence
│   ├── db.ts                 ← Drizzle client (direct Postgres)
│   ├── heartbeat.ts
│   ├── scheduler.ts          ← loads triggers, manages cron jobs
│   ├── trigger-runner.ts     ← fetch + Claude + write card
│   ├── claude-runner.ts      ← Claude API call with MCP servers
│   ├── action-watcher.ts     ← poll + execute action queue
│   ├── sse.ts                ← write SSE events to Postgres
│   └── integrations/
│       ├── outlook.ts
│       ├── teams.ts
│       └── github.ts
├── .env
├── package.json
└── tsconfig.json
```

---

## `src/index.ts`

```typescript
import { startHeartbeat } from './heartbeat'
import { startScheduler } from './scheduler'
import { startActionWatcher } from './action-watcher'
import { cleanupStuckActions } from './action-watcher'

async function main() {
  console.log('[agent] starting')
  await cleanupStuckActions()   // reset any 'processing' rows from last crash
  await startHeartbeat()
  await startScheduler()
  await startActionWatcher()
  console.log('[agent] running')
}

main().catch((err) => {
  console.error('[agent] fatal:', err)
  process.exit(1)
})
```

---

## `src/db.ts`

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../apps/web/lib/db/schema'  // shared schema

const pgClient = postgres(process.env.DATABASE_URL!)
export const db = drizzle(pgClient, { schema })
```

The agent imports the **same schema** from the web app. This is the main benefit of a monorepo — one source of truth for the DB shape.

---

## `src/claude-runner.ts`

The core of the agent. Calls the Claude API, passing MCP server(s) as tools. Claude fetches the integration data itself and returns a structured response.

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

interface RunClaudeOptions {
  promptTemplate: string
  mcpServers: Anthropic.McpServerConfig[]
  templateVars: Record<string, string>
}

interface ClaudeResult {
  reply: string
  summary: string
  title: string
}

export async function runClaude(opts: RunClaudeOptions): Promise<ClaudeResult> {
  const prompt = interpolate(opts.promptTemplate, opts.templateVars)

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    // MCP servers are passed here — Claude calls the tools itself
    mcp_servers: opts.mcpServers,
    messages: [{ role: 'user', content: prompt }],
  })

  // Extract the final text block (after any tool_use blocks)
  const textBlock = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  // Expect JSON from Claude: { title, reply, summary }
  // The prompt instructs Claude to respond in this format
  try {
    const parsed = JSON.parse(textBlock)
    return {
      title: parsed.title ?? 'New item',
      reply: parsed.reply ?? textBlock,
      summary: parsed.summary ?? textBlock.slice(0, 120),
    }
  } catch {
    return {
      title: 'New item',
      reply: textBlock,
      summary: textBlock.slice(0, 120).replace(/\n/g, ' '),
    }
  }
}

function interpolate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`)
}
```

---

## `src/trigger-runner.ts`

```typescript
import { db } from './db'
import { cards, sseEvents, processedItems } from '../../apps/web/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { runClaude } from './claude-runner'
import { getIntegration } from './integrations'

export async function runTrigger(trigger: Trigger) {
  console.log(`[trigger] ${trigger.name}`)

  const integration = getIntegration(trigger.integration)

  // Fetch new items from integration
  const items = await integration.fetchNew(trigger)
  if (items.length === 0) {
    console.log(`[trigger] no new items`)
    return
  }

  // Deduplicate — filter already-processed external IDs
  const externalIds = items.map(i => i.externalId)
  const done = await db
    .select({ externalId: processedItems.externalId })
    .from(processedItems)
    .where(
      and(
        eq(processedItems.userId, trigger.userId),
        eq(processedItems.integration, trigger.integration),
        inArray(processedItems.externalId, externalIds)
      )
    )
  const doneSet = new Set(done.map(d => d.externalId))
  const newItems = items.filter(i => !doneSet.has(i.externalId))

  console.log(`[trigger] ${newItems.length} new items (${items.length - newItems.length} already processed)`)

  for (const item of newItems) {
    // Run Claude — it uses MCP tools to get full content if needed
    const result = await runClaude({
      promptTemplate: trigger.promptTemplate,
      mcpServers: integration.mcpServers,
      templateVars: { ...item.templateVars, date: new Date().toISOString() },
    })

    // Write card
    const [card] = await db.insert(cards).values({
      userId: trigger.userId,
      categoryId: trigger.categoryId,
      triggerId: trigger.id,
      title: result.title,
      summary: result.summary,
      originalContent: item.raw,
      draftReply: result.reply,
      actionType: integration.actionType,
      actionMetadata: item.actionMetadata,
      status: 'pending',
    }).returning()

    // Emit SSE event so UI shows the card immediately
    await db.insert(sseEvents).values({
      userId: trigger.userId,
      eventType: 'card.created',
      payload: card,
    })

    // Mark as processed
    await db.insert(processedItems).values({
      userId: trigger.userId,
      integration: trigger.integration,
      externalId: item.externalId,
    }).onConflictDoNothing()
  }

  // Update last_run_at
  await db.update(triggers)
    .set({ lastRunAt: new Date() })
    .where(eq(triggers.id, trigger.id))
}
```

---

## `src/action-watcher.ts`

```typescript
import { db } from './db'
import { actionQueue, cards, sseEvents } from '../../apps/web/lib/db/schema'
import { eq, and, lt } from 'drizzle-orm'
import { getIntegration } from './integrations'

export async function startActionWatcher() {
  setInterval(processPending, 10_000)
}

export async function cleanupStuckActions() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
  await db.update(actionQueue)
    .set({ status: 'queued' })
    .where(and(eq(actionQueue.status, 'processing'), lt(actionQueue.createdAt, fiveMinutesAgo)))
  console.log('[agent] cleaned up stuck actions')
}

async function processPending() {
  const pending = await db.query.actionQueue.findMany({
    where: eq(actionQueue.status, 'queued'),
    limit: 5,
  })

  for (const action of pending) {
    await processAction(action)
  }
}

async function processAction(action: typeof actionQueue.$inferSelect) {
  await db.update(actionQueue).set({ status: 'processing' }).where(eq(actionQueue.id, action.id))

  try {
    // Derive integration from action type ('reply_email' → 'outlook', etc.)
    const integrationName = action.actionType.replace('reply_', '')
    const integration = getIntegration(integrationName)
    await integration.execute(action.payload as Record<string, unknown>)

    await db.update(actionQueue)
      .set({ status: 'done', processedAt: new Date() })
      .where(eq(actionQueue.id, action.id))

    const [updated] = await db.update(cards)
      .set({ status: 'done', updatedAt: new Date() })
      .where(eq(cards.id, action.cardId))
      .returning()

    // Notify UI
    await db.insert(sseEvents).values({
      userId: action.userId,
      eventType: 'card.updated',
      payload: updated,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[action] failed: ${message}`)
    await db.update(actionQueue).set({ status: 'failed', error: message }).where(eq(actionQueue.id, action.id))
    // Revert card to pending so user can retry
    await db.update(cards).set({ status: 'pending' }).where(eq(cards.id, action.cardId))
  }
}
```

---

## `.env`

```env
DATABASE_URL=postgresql://user:password@vps.yourdomain.com:5432/automation_hub
ANTHROPIC_API_KEY=sk-ant-...
AGENT_USER_ID=<uuid from users table>
ACTIVE_INTEGRATIONS=outlook,teams,github

# GitHub PAT — fine-grained, scoped to better-developers org
GITHUB_TOKEN=github_pat_...

# MS365 MCP server auth (if needed separately from Claude Desktop session)
# Usually the ms-365-mcp-server uses its own token store — leave blank if handled
MS365_TOKEN_STORE_PATH=/path/to/token/store
```

---

## `package.json`

```json
{
  "name": "@claude-hub/agent",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30",
    "drizzle-orm": "^0.38",
    "node-cron": "^3",
    "postgres": "^3"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

---

## Tasks checklist

- [ ] Package init, deps installed
- [ ] `src/db.ts` — Drizzle + direct Postgres connection
- [ ] `src/index.ts` — startup sequence
- [ ] `src/heartbeat.ts`
- [ ] `src/scheduler.ts` — load triggers + cron management
- [ ] `src/trigger-runner.ts` — deduplicate + write cards + SSE
- [ ] `src/claude-runner.ts` — Claude API + MCP + JSON extraction
- [ ] `src/action-watcher.ts` — poll + execute + cleanup
- [ ] `src/integrations/outlook.ts`
- [ ] `src/integrations/teams.ts`
- [ ] `src/integrations/github.ts`
- [ ] `.env.example`
- [ ] Test agent startup + heartbeat visible in UI
