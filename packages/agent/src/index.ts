import 'dotenv/config'
import { startHeartbeat } from './heartbeat'

console.log('[agent] starting...')
startHeartbeat()
console.log('[agent] heartbeat started')
