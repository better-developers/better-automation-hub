// Re-export shared types so consumers can import from one canonical place
export type { FetchedItem, McpServerConfig } from '../claude-runner'
export type { Integration } from '../trigger-runner'

import { registerIntegration } from '../trigger-runner'
import { outlookIntegration } from './outlook'
import { teamsIntegration } from './teams'
import { githubIntegration } from './github'

const ACTIVE_INTEGRATIONS = (process.env.ACTIVE_INTEGRATIONS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

/**
 * Register all integrations listed in ACTIVE_INTEGRATIONS env var.
 * Call once at agent startup before the scheduler starts.
 */
export function initIntegrations(): void {
  if (ACTIVE_INTEGRATIONS.length === 0) {
    console.warn('[integrations] ACTIVE_INTEGRATIONS is not set — no integrations will run')
    return
  }

  if (ACTIVE_INTEGRATIONS.includes('outlook')) {
    registerIntegration('outlook', outlookIntegration)
  }

  if (ACTIVE_INTEGRATIONS.includes('teams')) {
    registerIntegration('teams', teamsIntegration)
  }

  if (ACTIVE_INTEGRATIONS.includes('github')) {
    registerIntegration('github', githubIntegration)
  }

  console.log(`[integrations] active: ${ACTIVE_INTEGRATIONS.join(', ')}`)
}
