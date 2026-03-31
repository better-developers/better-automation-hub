import { db } from './db'
import { agentSessions } from '../../../apps/web/lib/db/schema'

const USER_ID = process.env.AGENT_USER_ID!
const ACTIVE_INTEGRATIONS = (process.env.ACTIVE_INTEGRATIONS ?? '').split(',').filter(Boolean)
const INTERVAL_MS = 30_000

export function startHeartbeat(): void {
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
  }

  // Fire immediately, then on interval
  beat()
  setInterval(beat, INTERVAL_MS)
}
