import { and, eq, lt } from 'drizzle-orm'
import { actionQueue, cards, sseEvents } from '../../../apps/web/lib/db/schema'
import { db } from './db'
import { getIntegration } from './trigger-runner'

const USER_ID = process.env.AGENT_USER_ID!
const POLL_INTERVAL_MS = 10_000
const STUCK_THRESHOLD_MS = 5 * 60 * 1000

/**
 * On startup: reset any actions stuck in 'processing' for longer than 5 minutes.
 * These are leftovers from a previous agent crash.
 */
export async function cleanupStuckActions(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS)
  const reset = await db
    .update(actionQueue)
    .set({ status: 'queued', processedAt: null })
    .where(
      and(
        eq(actionQueue.userId, USER_ID),
        eq(actionQueue.status, 'processing'),
        lt(actionQueue.createdAt, cutoff),
      ),
    )
    .returning({ id: actionQueue.id })
  if (reset.length > 0) {
    console.log(`[action-watcher] reset ${reset.length} stuck processing action(s)`)
  }
}

async function processNextBatch(): Promise<void> {
  const actions = await db
    .select()
    .from(actionQueue)
    .where(
      and(
        eq(actionQueue.userId, USER_ID),
        eq(actionQueue.status, 'queued'),
      ),
    )
    .limit(5)

  for (const action of actions) {
    // Claim the action before executing so concurrent agent instances don't double-process
    await db
      .update(actionQueue)
      .set({ status: 'processing' })
      .where(eq(actionQueue.id, action.id))

    try {
      const integration = getIntegration(action.actionType)
      if (!integration) {
        throw new Error(`No integration registered for actionType "${action.actionType}"`)
      }

      await integration.execute(action.payload as Record<string, unknown>)

      // Success: mark done and move card to done
      await db
        .update(actionQueue)
        .set({ status: 'done', processedAt: new Date() })
        .where(eq(actionQueue.id, action.id))

      await db
        .update(cards)
        .set({ status: 'done', updatedAt: new Date() })
        .where(eq(cards.id, action.cardId))

      await db.insert(sseEvents).values({
        userId: USER_ID,
        eventType: 'card.updated',
        payload: { cardId: action.cardId, status: 'done' },
      })

      console.log(`[action-watcher] action ${action.id} completed`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[action-watcher] action ${action.id} failed:`, errorMessage)

      // Failure: mark failed, revert card to pending
      await db
        .update(actionQueue)
        .set({ status: 'failed', error: errorMessage, processedAt: new Date() })
        .where(eq(actionQueue.id, action.id))

      await db
        .update(cards)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(cards.id, action.cardId))

      await db.insert(sseEvents).values({
        userId: USER_ID,
        eventType: 'card.updated',
        payload: { cardId: action.cardId, status: 'pending' },
      })
    }
  }
}

export function startActionWatcher(): void {
  console.log('[action-watcher] starting, polling every 10s')
  setInterval(() => {
    processNextBatch().catch((err) => {
      console.error('[action-watcher] unexpected error in poll cycle:', err)
    })
  }, POLL_INTERVAL_MS)
}
