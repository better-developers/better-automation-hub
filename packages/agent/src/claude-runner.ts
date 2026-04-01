import Anthropic from '@anthropic-ai/sdk'
import { spawn } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
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
  external_id?: string  // returned by Claude for per-item deduplication in batch responses
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

/**
 * Normalise a single parsed item (object) into a ClaudeResult.
 * Returns null if the item is not a valid result shape.
 */
function normaliseOne(item: unknown): ClaudeResult | null {
  if (item && typeof item === 'object') {
    const r = item as Record<string, unknown>
    if (typeof r.title === 'string') {
      return {
        title: r.title,
        reply: typeof r.reply === 'string' ? r.reply : '',
        summary: typeof r.summary === 'string' ? r.summary : '',
        // Capture external_id when Claude includes it (batch / per-item dedup)
        external_id: typeof r.external_id === 'string' ? r.external_id : undefined,
      }
    }
  }
  return null
}

/**
 * Normalise a parsed JSON value into a single ClaudeResult.
 * When Claude returns an array (batch trigger), the first element is used.
 */
function normaliseResult(parsed: unknown): ClaudeResult | null {
  const item = Array.isArray(parsed) ? parsed[0] : parsed
  return normaliseOne(item)
}

/**
 * Normalise a parsed JSON value into ALL ClaudeResults.
 * Handles both single-object and array responses from Claude.
 * Used when a batch trigger expects Claude to return one result per input item.
 */
export function normaliseAllResults(parsed: unknown): ClaudeResult[] {
  const items = Array.isArray(parsed) ? parsed : [parsed]
  return items.map(normaliseOne).filter((r): r is ClaudeResult => r !== null)
}

// ---------------------------------------------------------------------------
// Subscription mode — uses the `claude` CLI (Claude Code) instead of API key
// ---------------------------------------------------------------------------

/**
 * Run a prompt through the `claude --print` CLI.
 * Requires Claude Code to be installed and logged in (`claude login`).
 * Set CLAUDE_USE_SUBSCRIPTION=true in the agent .env to enable this mode.
 *
 * MCP servers are supported via a temporary config file passed to --mcp-config.
 */
async function runClaudeViaCLI(prompt: string, mcpServers: McpServerConfig[]): Promise<string> {
  const args = ['--print', '--output-format', 'text']

  let mcpConfigPath: string | null = null
  if (mcpServers.length > 0) {
    // Write a temporary MCP config file for this invocation
    mcpConfigPath = join(tmpdir(), `mcp-config-${randomUUID()}.json`)
    const mcpConfig = {
      mcpServers: Object.fromEntries(
        mcpServers.map((s) => [
          s.name,
          { type: 'url', url: s.url },
        ]),
      ),
    }
    await writeFile(mcpConfigPath, JSON.stringify(mcpConfig), 'utf8')
    args.push('--mcp-config', mcpConfigPath)
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, { timeout: 120_000 })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', async (code) => {
      if (mcpConfigPath) {
        await unlink(mcpConfigPath).catch(() => {})
      }
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`))
      }
    })

    proc.on('error', async (err) => {
      if (mcpConfigPath) {
        await unlink(mcpConfigPath).catch(() => {})
      }
      reject(new Error(`Failed to spawn claude CLI: ${err.message}. Is Claude Code installed? Run: npm install -g @anthropic-ai/claude-code`))
    })

    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

// Lazily initialise the API client only when needed (API key mode)
let _client: Anthropic | null = null
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

const useSubscription = process.env.CLAUDE_USE_SUBSCRIPTION === 'true'

if (useSubscription) {
  console.log('[claude-runner] subscription mode enabled — using `claude` CLI (no API key required)')
} else if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[claude-runner] WARNING: ANTHROPIC_API_KEY is not set. ' +
    'Set it, or set CLAUDE_USE_SUBSCRIPTION=true to use your Claude Code subscription.',
  )
}

export async function runClaude(
  trigger: Trigger,
  item: Pick<FetchedItem, 'templateVars'>,
  mcpServers: McpServerConfig[],
): Promise<ClaudeResult> {
  const prompt = interpolate(trigger.promptTemplate, item.templateVars)

  let text: string

  if (useSubscription) {
    // --- Subscription mode: delegate to `claude --print` CLI ---
    text = await runClaudeViaCLI(prompt, mcpServers)
  } else {
    // --- API key mode: use @anthropic-ai/sdk directly ---
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

    const response = await (getClient().beta.messages.create as (p: BetaParams) => Promise<BetaResponse>)({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      mcp_servers: mcpServers,
      messages: [{ role: 'user', content: prompt }],
      betas: ['mcp-client-2025-04-04'],
    })

    const textBlock = response.content.find((b) => b.type === 'text')
    text = textBlock?.text ?? ''
  }

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
