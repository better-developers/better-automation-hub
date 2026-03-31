import { db } from './db'
import { agentSessions, manualRunRequests } from '../../../apps/web/lib/db/schema'
import { runTrigger } from './scheduler'
import { and, eq, isNull } from 'drizzle-orm'

const USER_ID = process.env.AGENT_USER_ID!
const ACTIVE_INTEGRATIONS = (process.env.ACTIVE_INTEGRATIONS ?? '').split(',').filter(Boolean)
const INTERVAL_MS = 30_000

export function startHeartbeat(): ReturnType<typeof setInterval> {
  async function beat() {
    try {
      await db
        .insert(agentSessions)
        .values({
          userId: USER_ID,
          lastSeen: new Date(),
          integrations: ACTIVE_INTEGRATIONS,
        })
        .onConflictDoUpdate({
          target: agentSessions.userId,
          set: {
            lastSeen: new Date(),
            integrations: ACTIVE_INTEGRATIONS,
          },
        })
    } catch (err) {
      console.error('[heartbeat] failed:', err)
    }

    // Check for pending manual run requests and execute them immediately
    try {
      const pending = await db
        .select()
        .from(manualRunRequests)
        .where(
          and(
            eq(manualRunRequests.userId, USER_ID),
            isNull(manualRunRequests.processedAt),
          ),
        )

      for (const req of pending) {
        try {
          await runTrigger(req.triggerId)
          await db
            .update(manualRunRequests)
            .set({ processedAt: new Date() })
            .where(eq(manualRunRequests.id, req.id))
          console.log(`[heartbeat] manual run processed for trigger ${req.triggerId}`)
        } catch (err) {
          console.error(`[heartbeat] manual run failed for trigger ${req.triggerId}:`, err)
        }
      }
    } catch (err) {
      console.error('[heartbeat] manual run check failed:', err)
    }
  }

  // Fire immediately, then on interval
  beat()
  return setInterval(beat, INTERVAL_MS)
}
