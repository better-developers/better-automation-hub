import 'dotenv/config'
import { startHeartbeat } from './heartbeat'
import { startScheduler } from './scheduler'
import { startSseCleanup } from './sse-cleanup'
import { startActionWatcher, cleanupStuckActions } from './action-watcher'
import { initIntegrations } from './integrations'

console.log('[agent] starting...')

initIntegrations()

const heartbeatInterval = startHeartbeat()
console.log('[agent] heartbeat started')

cleanupStuckActions().catch((err) => console.error('[agent] startup cleanup error:', err))

startScheduler()
startSseCleanup()
startActionWatcher()

process.on('SIGINT', () => {
  console.log('[agent] shutting down')
  clearInterval(heartbeatInterval)
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('[agent] shutting down')
  clearInterval(heartbeatInterval)
  process.exit(0)
})
