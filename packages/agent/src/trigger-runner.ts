import { and, eq, inArray } from 'drizzle-orm'
import {
  cards,
  processedItems,
  sseEvents,
  triggers,
} from '../../../apps/web/lib/db/schema'
import { runClaude, type FetchedItem, type McpServerConfig } from './claude-runner'
import { db } from './db'

const USER_ID = process.env.AGENT_USER_ID!

// ---------------------------------------------------------------------------
// Integration interface
// Duplicated here until the Phase-5 integration registry lives in
// src/integrations/index.ts — at that point this export is replaced.
// ---------------------------------------------------------------------------

export interface Integration {
  fetchNew(trigger: typeof triggers.$inferSelect): Promise<FetchedItem[]>
  execute(payload: Record<string, unknown>): Promise<void>
  mcpServers: McpServerConfig[]
  actionType: string  // 'reply_email' | 'reply_teams' | 'reply_github'
}

// ---------------------------------------------------------------------------
// Registry — populated at agent startup by each integration module
// ---------------------------------------------------------------------------

const registry = new Map<string, Integration>()

export function registerIntegration(name: string, integration: Integration): void {
  registry.set(name, integration)
  console.log(`[trigger-runner] registered integration "${name}"`)
}

/** Look up a registered integration by its actionType (e.g. 'reply_email'). */
export function getIntegration(actionType: string): Integration | undefined {
  for (const integration of registry.values()) {
    if (integration.actionType === actionType) {
      return integration
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Core runner — called by scheduler and manual-run handler
// ---------------------------------------------------------------------------

export async function runTrigger(triggerId: string): Promise<void> {
  const [trigger] = await db
    .select()
    .from(triggers)
    .where(eq(triggers.id, triggerId))
    .limit(1)

  if (!trigger) {
    console.warn(`[trigger-runner] trigger ${triggerId} not found — skipping`)
    return
  }

  const integration = registry.get(trigger.integration)
  if (!integration) {
    console.warn(
      `[trigger-runner] no integration registered for "${trigger.integration}" — skipping trigger "${trigger.name}"`,
    )
    await updateLastRunAt(triggerId)
    return
  }

  await runTriggerWithIntegration(trigger, integration)
}

async function runTriggerWithIntegration(
  trigger: typeof triggers.$inferSelect,
  integration: Integration,
): Promise<void> {
  console.log(`[trigger-runner] running "${trigger.name}" [${trigger.id}]`)

  // 1. Fetch new items from the integration
  const items = await integration.fetchNew(trigger)

  if (items.length === 0) {
    console.log(`[trigger-runner] no items fetched for trigger ${trigger.id}`)
    await updateLastRunAt(trigger.id)
    return
  }

  // 2. Filter already-processed external IDs
  const externalIds = items.map((i) => i.externalId)

  const already = await db
    .select({ externalId: processedItems.externalId })
    .from(processedItems)
    .where(
      and(
        eq(processedItems.userId, USER_ID),
        eq(processedItems.integration, trigger.integration),
        inArray(processedItems.externalId, externalIds),
      ),
    )

  const processedSet = new Set(already.map((r) => r.externalId))
  const newItems = items.filter((item) => !processedSet.has(item.externalId))

  console.log(
    `[trigger-runner] ${newItems.length} new / ${items.length - newItems.length} already processed`,
  )

  // 3. Process each new item: Claude → card → SSE event → mark processed
  for (const item of newItems) {
    try {
      const result = await runClaude(trigger, item, integration.mcpServers)

      // Insert card
      const [card] = await db
        .insert(cards)
        .values({
          userId: USER_ID,
          categoryId: trigger.categoryId,
          triggerId: trigger.id,
          title: result.title,
          summary: result.summary,
          originalContent: item.raw as Record<string, unknown>,
          draftReply: result.reply,
          status: 'pending',
          actionType: integration.actionType,
          actionMetadata: item.actionMetadata as Record<string, unknown>,
        })
        .returning()

      // Emit SSE event so the board updates in real-time
      await db.insert(sseEvents).values({
        userId: USER_ID,
        eventType: 'card.created',
        payload: { cardId: card.id, triggerId: trigger.id },
      })

      // Mark as processed — onConflictDoNothing guards against race conditions
      await db
        .insert(processedItems)
        .values({
          userId: USER_ID,
          integration: trigger.integration,
          externalId: item.externalId,
        })
        .onConflictDoNothing()

      console.log(`[trigger-runner] created card "${result.title}" (externalId: ${item.externalId})`)
    } catch (err) {
      console.error(`[trigger-runner] error processing item ${item.externalId}:`, err)
      // Continue with remaining items rather than aborting the whole run
    }
  }

  // 4. Update lastRunAt
  await updateLastRunAt(trigger.id)
}

async function updateLastRunAt(triggerId: string): Promise<void> {
  await db
    .update(triggers)
    .set({ lastRunAt: new Date() })
    .where(eq(triggers.id, triggerId))
}
