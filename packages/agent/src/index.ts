import 'dotenv/config'
import { startHeartbeat } from './heartbeat'
import { startScheduler } from './scheduler'
import { registerIntegration } from './integrations/index'
import { outlookIntegration } from './integrations/outlook'
import { teamsIntegration } from './integrations/teams'
import { githubIntegration } from './integrations/github'

console.log('[agent] starting...')

// Register integrations based on ACTIVE_INTEGRATIONS env var
const activeIntegrations = (process.env.ACTIVE_INTEGRATIONS ?? 'outlook,teams,github')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (activeIntegrations.includes('outlook')) {
  registerIntegration('outlook', outlookIntegration)
  console.log('[agent] registered integration: outlook')
}
if (activeIntegrations.includes('teams')) {
  registerIntegration('teams', teamsIntegration)
  console.log('[agent] registered integration: teams')
}
if (activeIntegrations.includes('github')) {
  registerIntegration('github', githubIntegration)
  console.log('[agent] registered integration: github')
}

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
