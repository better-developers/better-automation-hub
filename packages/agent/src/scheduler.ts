import { db } from './db'
import { triggers } from '../../../apps/web/lib/db/schema'
import { eq } from 'drizzle-orm'
import cron from 'node-cron'

const USER_ID = process.env.AGENT_USER_ID!
const RESYNC_INTERVAL_MS = 2 * 60 * 1000

interface ScheduledEntry {
  task: cron.ScheduledTask
  schedule: string
}

const scheduledTasks = new Map<string, ScheduledEntry>()

// Replaced in Phase 4 by the real trigger-runner import
async function runTrigger(triggerId: string): Promise<void> {
  console.log(`[scheduler] trigger fired: ${triggerId}`)
}

async function syncTriggers(): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(triggers)
      .where(eq(triggers.userId, USER_ID))

    const enabledMap = new Map(
      rows.filter((t) => t.enabled).map((t) => [t.id, t]),
    )

    // Stop tasks for triggers that are deleted or disabled
    for (const [id, entry] of scheduledTasks.entries()) {
      if (!enabledMap.has(id)) {
        entry.task.stop()
        scheduledTasks.delete(id)
        console.log(`[scheduler] unscheduled trigger ${id}`)
      }
    }

    // Add or recreate tasks for enabled triggers
    for (const [id, trigger] of enabledMap.entries()) {
      if (!cron.validate(trigger.schedule)) {
        console.warn(
          `[scheduler] invalid schedule "${trigger.schedule}" for trigger ${id} ("${trigger.name}") — skipping`,
        )
        continue
      }

      const existing = scheduledTasks.get(id)

      // Skip if already scheduled with the same expression
      if (existing && existing.schedule === trigger.schedule) {
        continue
      }

      // Schedule changed — stop old task before recreating
      if (existing) {
        existing.task.stop()
        scheduledTasks.delete(id)
      }

      const task = cron.schedule(trigger.schedule, () => {
        runTrigger(id).catch((err) =>
          console.error(`[scheduler] trigger ${id} error:`, err),
        )
      })

      scheduledTasks.set(id, { task, schedule: trigger.schedule })
      console.log(
        `[scheduler] scheduled "${trigger.name}" [${id}] @ ${trigger.schedule}`,
      )
    }
  } catch (err) {
    console.error('[scheduler] sync error:', err)
  }
}

export function startScheduler(): void {
  void syncTriggers()
  setInterval(() => void syncTriggers(), RESYNC_INTERVAL_MS)
  console.log('[scheduler] started (re-syncs every 2 min)')
}
