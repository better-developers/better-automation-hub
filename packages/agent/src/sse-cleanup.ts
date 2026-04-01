import cron from 'node-cron'
import { lt } from 'drizzle-orm'
import { db } from './db'
import { sseEvents } from '../../../apps/web/lib/db/schema'

async function pruneOldSseEvents(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const result = await db
      .delete(sseEvents)
      .where(lt(sseEvents.createdAt, cutoff))
    console.log(`[sse-cleanup] pruned rows older than ${cutoff.toISOString()}`)
  } catch (err) {
    console.error('[sse-cleanup] failed:', err)
  }
}

export function startSseCleanup(): void {
  // Run once at startup to clear any backlog
  void pruneOldSseEvents()

  // Then prune daily at midnight
  cron.schedule('0 0 * * *', () => {
    void pruneOldSseEvents()
  })

  console.log('[sse-cleanup] started (runs daily at midnight)')
}
