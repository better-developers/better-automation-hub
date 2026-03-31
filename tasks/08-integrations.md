# 08 — Integrations (v1: Outlook, Teams, GitHub)

## Integration interface

```typescript
// integrations/index.ts
export interface FetchedItem {
  externalId: string                        // unique ID for deduplication
  templateVars: Record<string, string>      // {{variables}} for the prompt
  raw: Record<string, unknown>              // stored as original_content on card
  actionMetadata: Record<string, unknown>   // stored on card, used by execute()
}

export interface Integration {
  actionType: string
  mcpServers: McpServerConfig[]             // passed to Claude API
  fetchNew(trigger: Trigger): Promise<FetchedItem[]>
  execute(payload: Record<string, unknown>): Promise<void>
}

type McpServerConfig = {
  type: 'url'
  url: string
  name: string
}

const registry: Record<string, Integration> = {}
export const registerIntegration = (name: string, impl: Integration) => { registry[name] = impl }
export const getIntegration = (name: string) => {
  if (!registry[name]) throw new Error(`Unknown integration: ${name}`)
  return registry[name]
}
```

---

## How MCP + Claude works for the agent

The agent does **not** call MCP tools directly. Instead, it passes the MCP server URL to the Claude API, and Claude calls the tools itself. The prompt instructs Claude exactly what to fetch and what to return.

```typescript
// Conceptually, each trigger's prompt looks like:
// "Use the ms365 MCP server to fetch the last 10 unread emails received after {{date}}.
//  For each one, generate a draft reply. Return them as a JSON array."
//
// Claude handles all the tool calls and returns structured JSON.
// The agent just parses the output and creates cards.
```

This means each integration's `fetchNew` is essentially just building the right prompt context and returning the items Claude found.

---

## Outlook integration

**MCP server:** `https://ms365.mcp.yourserver.com/mcp` (Softeria ms-365-mcp-server)

### How to get the MCP server URL

The Softeria ms-365-mcp-server runs locally. To expose it to the Claude API (which needs a URL), you have two options:

**Option A (recommended): Run ms-365-mcp-server in HTTP/SSE mode**
```bash
# Softeria supports --transport sse flag
npx @softeria/ms-365-mcp-server --transport sse --port 3001
```
Then expose it via an SSH tunnel or Cloudflare tunnel:
```bash
cloudflared tunnel --url http://localhost:3001
# Gives you: https://xxxx.trycloudflare.com
```

**Option B: Use the MCP server locally in the agent process**
Use `@modelcontextprotocol/sdk` to spawn the server as a subprocess and call tools directly. Simpler if you don't want to expose a tunnel.

For now, the plan assumes Option A. If you switch to Option B, replace the `mcpServers` array with direct SDK calls.

### `integrations/outlook.ts`

```typescript
import { registerIntegration } from './index'
import { db } from '../db'
import { actionQueue } from '../../../apps/web/lib/db/schema'

const MS365_MCP_URL = process.env.MS365_MCP_URL!

registerIntegration('outlook', {
  actionType: 'reply_email',
  mcpServers: [{ type: 'url', url: MS365_MCP_URL, name: 'ms365' }],

  async fetchNew(trigger) {
    // The prompt template for Outlook triggers instructs Claude to:
    // 1. Use list-mail-messages to get emails since last_run_at
    // 2. Return them as a JSON array with id, from, subject, body, receivedAt
    // Claude handles all the tool calls.
    // The agent passes this context via templateVars and gets structured items back.
    //
    // NOTE: For Outlook, fetchNew returns a SINGLE synthetic item representing
    // "the batch of unread emails". Claude processes them all in one call and
    // returns a JSON array. The trigger-runner handles the array case.
    return [{
      externalId: `outlook-batch-${Date.now()}`,
      templateVars: {
        since: trigger.lastRunAt?.toISOString() ?? new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      raw: {},
      actionMetadata: {},
    }]
  },

  // NOTE: The execute function is called per-action (one per card).
  // The card's action_metadata contains the specific message_id.
  async execute(payload) {
    // Payload: { message_id, body }
    // We call the Claude API with MCP to send the reply
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      mcp_servers: [{ type: 'url', url: MS365_MCP_URL, name: 'ms365' }],
      messages: [{
        role: 'user',
        content: `Reply to email with message ID "${payload.message_id}" with this text:\n\n${payload.body}\n\nUse the reply-mail-message tool. Do not add any extra text.`,
      }],
    })
  },
})
```

### Outlook prompt template (configured in UI)

```
Use the ms365 MCP server to fetch unread emails in my inbox received after {{since}}.

For each email, generate a professional reply. Match the language of the email (Danish or English). Keep replies to 3–4 sentences.

Return ONLY a JSON array — no markdown, no preamble:
[
  {
    "external_id": "<message id from MS365>",
    "title": "<subject line, max 60 chars>",
    "summary": "<one sentence summary, max 100 chars>",
    "reply": "<reply body, no greeting or sign-off>",
    "message_id": "<message id>",
    "thread_id": "<conversation id>",
    "to": "<sender email address>",
    "subject": "<original subject>"
  }
]

If there are no new emails, return an empty array: []
```

Note: when Claude returns a JSON array, `trigger-runner.ts` handles it differently — it creates one card per array item. Add this array-detection logic:

```typescript
// In trigger-runner.ts, after runClaude():
let items
try {
  items = JSON.parse(result.reply)
  if (!Array.isArray(items)) items = [result]
} catch {
  items = [result]
}
// Then loop over items to create cards
```

---

## Teams integration

**MCP server:** Same ms-365-mcp-server URL — it handles both Outlook and Teams.

### `integrations/teams.ts`

```typescript
registerIntegration('teams', {
  actionType: 'reply_teams',
  mcpServers: [{ type: 'url', url: MS365_MCP_URL, name: 'ms365' }],

  async fetchNew(trigger) {
    const config = trigger.integrationConfig as { team_id: string; channel_id: string }
    return [{
      externalId: `teams-batch-${trigger.id}-${Date.now()}`,
      templateVars: {
        team_id: config.team_id,
        channel_id: config.channel_id,
        since: trigger.lastRunAt?.toISOString() ?? new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      raw: {},
      actionMetadata: { team_id: config.team_id, channel_id: config.channel_id },
    }]
  },

  async execute(payload) {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      mcp_servers: [{ type: 'url', url: MS365_MCP_URL, name: 'ms365' }],
      messages: [{
        role: 'user',
        content: `Reply to Teams message ID "${payload.message_id}" in channel "${payload.channel_id}" with:\n\n${payload.body}\n\nUse the reply-to-channel-message tool.`,
      }],
    })
  },
})
```

### Teams prompt template

```
Use the ms365 MCP server to fetch recent messages in Teams channel {{channel_id}} (team {{team_id}}) posted after {{since}}.

For each message that needs a response (skip bot messages and your own messages), generate a brief reply (1–3 sentences). Match the tone.

Return ONLY a JSON array:
[
  {
    "external_id": "<message id>",
    "title": "<short description, max 60 chars>",
    "summary": "<one sentence, max 100 chars>",
    "reply": "<reply text>",
    "message_id": "<message id>",
    "channel_id": "{{channel_id}}",
    "from": "<sender name>"
  }
]

If no messages need a reply, return: []
```

---

## GitHub integration

**MCP server:** The GitHub MCP server (`https://api.githubcopilot.com/mcp/` or self-hosted via `@modelcontextprotocol/server-github`).

### `integrations/github.ts`

```typescript
const GITHUB_MCP_URL = process.env.GITHUB_MCP_URL ?? 'https://api.githubcopilot.com/mcp/'

registerIntegration('github', {
  actionType: 'reply_github',
  mcpServers: [{ type: 'url', url: GITHUB_MCP_URL, name: 'github', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }],

  async fetchNew(trigger) {
    const config = trigger.integrationConfig as {
      owner: string
      repo: string
      watch: ('issues' | 'pull_requests' | 'pr_comments' | 'mentions')[]
    }
    return [{
      externalId: `github-batch-${trigger.id}-${Date.now()}`,
      templateVars: {
        repo: `${config.owner}/${config.repo}`,
        owner: config.owner,
        repo_name: config.repo,
        watch: config.watch.join(', '),
        since: trigger.lastRunAt?.toISOString() ?? new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      raw: {},
      actionMetadata: { owner: config.owner, repo: config.repo },
    }]
  },

  async execute(payload) {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      mcp_servers: [{ type: 'url', url: GITHUB_MCP_URL, name: 'github', headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } }],
      messages: [{
        role: 'user',
        content: `Add this comment to GitHub issue #${payload.issue_number} in repo ${payload.repo}:\n\n${payload.body}\n\nUse the add_issue_comment tool.`,
      }],
    })
  },
})
```

### GitHub prompt template

```
Use the GitHub MCP server to check for recent activity in {{repo}} since {{since}}.

Watch for: {{watch}}

For each new issue, PR, PR comment, or mention of @casper-bessler (adjust to your GitHub handle):
- Understand what's being asked
- Generate a helpful, concise response (1–3 sentences)

Return ONLY a JSON array:
[
  {
    "external_id": "<owner/repo#number-commentid>",
    "title": "<type + title, max 60 chars, e.g. 'Issue #42: Login fails on mobile'>",
    "summary": "<one sentence, max 100 chars>",
    "reply": "<response text>",
    "issue_number": <number>,
    "repo": "{{repo}}",
    "event_type": "issue|pr|pr_comment|mention",
    "author": "<github username>"
  }
]

If nothing needs a reply, return: []
```

---

## Deduplication across restarts

With the batch approach, each run produces a single `externalId` like `outlook-batch-1735000000000`. This means deduplication doesn't work per-email — it just prevents the same batch from running twice.

For true per-item deduplication, extract `external_id` from Claude's JSON response and insert them into `processed_items` after creating cards. The `trigger-runner.ts` array loop handles this:

```typescript
for (const item of items) {
  // Use item.external_id (from Claude's JSON) as the deduplication key
  const alreadyDone = await db.query.processedItems.findFirst({
    where: and(
      eq(processedItems.userId, trigger.userId),
      eq(processedItems.integration, trigger.integration),
      eq(processedItems.externalId, item.external_id)
    )
  })
  if (alreadyDone) continue

  // create card...

  await db.insert(processedItems).values({
    userId: trigger.userId,
    integration: trigger.integration,
    externalId: item.external_id,
  }).onConflictDoNothing()
}
```

---

## Environment variables for integrations

```env
MS365_MCP_URL=https://xxxx.trycloudflare.com     # or your tunnel URL
GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/
GITHUB_TOKEN=github_pat_...                       # fine-grained PAT for better-developers org
```

---

## Tasks checklist

- [ ] `integrations/index.ts` — interface + registry
- [ ] `integrations/outlook.ts` — fetchNew + execute
- [ ] `integrations/teams.ts` — fetchNew + execute
- [ ] `integrations/github.ts` — fetchNew + execute
- [ ] Update `trigger-runner.ts` to handle JSON array responses from Claude
- [ ] Per-item deduplication using `external_id` from Claude JSON
- [ ] ms-365-mcp-server running in SSE mode + exposed via tunnel
- [ ] GitHub MCP server auth configured
- [ ] Test each integration independently with `npm run dev` + manual trigger run
