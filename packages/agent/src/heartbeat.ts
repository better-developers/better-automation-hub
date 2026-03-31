import { db } from './db'
import { agentSessions } from '../../../apps/web/lib/db/schema'
import { eq } from 'drizzle-orm'

const HEARTBEAT_INTERVAL_MS = 30_000

const userId = process.env.AGENT_USER_ID!
const activeIntegrations = (process.env.ACTIVE_INTEGRATIONS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

async function upsertHeartbeat() {
  await db
    .insert(agentSessions)
    .values({
      userId,
      lastSeen: new Date(),
      integrations: activeIntegrations,
    })
    .onConflictDoUpdate({
      target: agentSessions.userId,
      set: {
        lastSeen: new Date(),
        integrations: activeIntegrations,
      },
    })
}

export function startHeartbeat() {
  upsertHeartbeat().catch((err) =>
    console.error('[heartbeat] initial upsert failed:', err)
  )

  setInterval(() => {
    upsertHeartbeat().catch((err) =>
      console.error('[heartbeat] upsert failed:', err)
    )
  }, HEARTBEAT_INTERVAL_MS)

  console.log('[heartbeat] started — userId:', userId)
}
