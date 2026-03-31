import type { triggers } from '../../../../apps/web/lib/db/schema'

// ---------------------------------------------------------------------------
// Integration interfaces — canonical source of truth
// Re-exported from claude-runner.ts for backwards-compatibility
// ---------------------------------------------------------------------------

export interface FetchedItem {
  externalId: string
  templateVars: Record<string, string>
  raw: unknown
  actionMetadata: unknown
}

export interface McpServerConfig {
  type: 'url'
  url: string
  name: string
}

type Trigger = typeof triggers.$inferSelect

export interface Integration {
  fetchNew(trigger: Trigger): Promise<FetchedItem[]>
  execute(payload: Record<string, unknown>): Promise<void>
  mcpServers: McpServerConfig[]
  actionType: string  // 'reply_email' | 'reply_teams' | 'reply_github'
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, Integration>()

export function registerIntegration(name: string, integration: Integration): void {
  registry.set(name, integration)
}

export function getIntegration(name: string): Integration {
  const integration = registry.get(name)
  if (!integration) {
    throw new Error(`No integration registered for: ${name}`)
  }
  return integration
}

export function listIntegrations(): string[] {
  return [...registry.keys()]
}
