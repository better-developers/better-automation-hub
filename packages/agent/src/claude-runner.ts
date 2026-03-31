import Anthropic from '@anthropic-ai/sdk'
import type { triggers } from '../../../apps/web/lib/db/schema'

// ---------------------------------------------------------------------------
// Shared types (will be re-exported from integrations/index.ts in Phase 5)
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

export interface ClaudeResult {
  title: string
  reply: string
  summary: string
}

type Trigger = typeof triggers.$inferSelect

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')
}

function extractJson(text: string): unknown {
  // Try fenced code block first (```json ... ``` or ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {}
  }

  // Try bare JSON array or object
  const array = text.match(/(\[[\s\S]*\])/)
  if (array) {
    try {
      return JSON.parse(array[1])
    } catch {}
  }

  const object = text.match(/(\{[\s\S]*\})/)
  if (object) {
    try {
      return JSON.parse(object[1])
    } catch {}
  }

  return null
}

function normaliseResult(parsed: unknown): ClaudeResult | null {
  // Support both a single object and an array (batch trigger response)
  const item = Array.isArray(parsed) ? parsed[0] : parsed

  if (item && typeof item === 'object') {
    const r = item as Record<string, unknown>
    if (typeof r.title === 'string') {
      return {
        title: r.title,
        reply: typeof r.reply === 'string' ? r.reply : '',
        summary: typeof r.summary === 'string' ? r.summary : '',
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const client = new Anthropic()

export async function runClaude(
  trigger: Trigger,
  item: Pick<FetchedItem, 'templateVars'>,
  mcpServers: McpServerConfig[],
): Promise<ClaudeResult> {
  const prompt = interpolate(trigger.promptTemplate, item.templateVars)

  type BetaParams = {
    model: string
    max_tokens: number
    mcp_servers: McpServerConfig[]
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    betas: string[]
  }

  type BetaResponse = {
    content: Array<{ type: string; text?: string }>
  }

  const response = await (client.beta.messages.create as (p: BetaParams) => Promise<BetaResponse>)({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    mcp_servers: mcpServers,
    messages: [{ role: 'user', content: prompt }],
    betas: ['mcp-client-2025-04-04'],
  })

  const textBlock = response.content.find((b) => b.type === 'text')
  const text = textBlock?.text ?? ''

  const parsed = normaliseResult(extractJson(text))
  if (parsed) return parsed

  // Plain-text fallback: use first line as title, full text as reply
  const firstLine = text.split('\n')[0].trim()
  return {
    title: firstLine.slice(0, 100) || 'New item',
    reply: text,
    summary: text.slice(0, 200),
  }
}
