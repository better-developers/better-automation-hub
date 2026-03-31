import 'dotenv/config'
import { startHeartbeat } from './heartbeat'
import { startScheduler } from './scheduler'

console.log('[agent] starting...')

const heartbeatInterval = startHeartbeat()
console.log('[agent] heartbeat started')

startScheduler()

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
