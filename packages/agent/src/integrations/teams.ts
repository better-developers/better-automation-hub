import { eq } from 'drizzle-orm'
import { authAccounts } from '../../../../apps/web/lib/db/schema'
import type { triggers } from '../../../../apps/web/lib/db/schema'
import { db } from '../db'
import type { FetchedItem, McpServerConfig } from '../claude-runner'
import type { Integration } from '../trigger-runner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphTeamsMessage {
  id: string
  createdDateTime: string
  lastModifiedDateTime: string
  body: { content: string; contentType: string }
  from: {
    user?: { displayName: string; id: string }
    application?: { displayName: string; id: string }
  }
  channelIdentity?: { teamId: string; channelId: string }
  replyToId?: string
}

type Trigger = typeof triggers.$inferSelect

// ---------------------------------------------------------------------------
// MS Graph helpers
// ---------------------------------------------------------------------------

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const USER_ID = process.env.AGENT_USER_ID!

async function getAccessToken(): Promise<string> {
  const [account] = await db
    .select({ accessToken: authAccounts.accessToken })
    .from(authAccounts)
    .where(eq(authAccounts.userId, USER_ID))
    .limit(1)

  if (!account?.accessToken) {
    throw new Error('No MS access token found for user — log in via the web app first')
  }

  return account.accessToken
}

async function graphGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`MS Graph GET ${path} failed: ${res.status} — ${body}`)
  }

  return res.json() as Promise<T>
}

async function graphPost(token: string, path: string, payload: unknown): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`MS Graph POST ${path} failed: ${res.status} — ${body}`)
  }
}

// ---------------------------------------------------------------------------
// fetchNew — list new channel messages since lastRunAt
// ---------------------------------------------------------------------------

async function fetchChannelMessages(
  token: string,
  teamId: string,
  channelId: string,
  since: Date | null,
): Promise<GraphTeamsMessage[]> {
  // MS Graph supports $filter on createdDateTime for channel messages
  let path = `/teams/${teamId}/channels/${channelId}/messages?$top=25`
  if (since) {
    const isoSince = since.toISOString()
    path += `&$filter=${encodeURIComponent(`createdDateTime gt ${isoSince}`)}`
  }

  const data = await graphGet<{ value: GraphTeamsMessage[] }>(token, path)
  return data.value ?? []
}

// ---------------------------------------------------------------------------
// execute — post a reply to a channel thread
// ---------------------------------------------------------------------------

async function postReply(
  token: string,
  teamId: string,
  channelId: string,
  messageId: string,
  replyText: string,
): Promise<void> {
  await graphPost(
    token,
    `/teams/${teamId}/channels/${channelId}/messages/${messageId}/replies`,
    {
      body: { contentType: 'text', content: replyText },
    },
  )
}

// ---------------------------------------------------------------------------
// Integration export
// ---------------------------------------------------------------------------

const mcpServers: McpServerConfig[] = process.env.MS365_MCP_URL
  ? [{ type: 'url', url: process.env.MS365_MCP_URL, name: 'ms365' }]
  : []

export const teamsIntegration: Integration = {
  actionType: 'reply_teams',
  mcpServers,

  async fetchNew(trigger: Trigger): Promise<FetchedItem[]> {
    const token = await getAccessToken()
    const config = (trigger.integrationConfig ?? {}) as Record<string, unknown>

    const teamId = config.team_id as string | undefined
    const channelId = config.channel_id as string | undefined

    if (!teamId || !channelId) {
      console.warn('[teams] integrationConfig missing team_id or channel_id — skipping')
      return []
    }

    const messages = await fetchChannelMessages(
      token,
      teamId,
      channelId,
      trigger.lastRunAt ?? null,
    )

    return messages.map((msg) => {
      const author =
        msg.from?.user?.displayName ??
        msg.from?.application?.displayName ??
        'Unknown'

      return {
        externalId: msg.id,
        templateVars: {
          content:   msg.body?.content ?? '',
          date:      msg.createdDateTime ?? '',
          thread_id: msg.id,
          channel:   channelId,
          team:      teamId,
          author,
        },
        raw: msg,
        actionMetadata: {
          message_id: msg.id,
          team_id:    teamId,
          channel_id: channelId,
          author,
        },
      }
    })
  },

  async execute(payload: Record<string, unknown>): Promise<void> {
    const messageId = payload.message_id as string | undefined
    const teamId    = payload.team_id as string | undefined
    const channelId = payload.channel_id as string | undefined
    const reply     = (payload.reply ?? payload.draft_reply) as string | undefined

    if (!messageId) throw new Error('teams execute: missing message_id in payload')
    if (!teamId)    throw new Error('teams execute: missing team_id in payload')
    if (!channelId) throw new Error('teams execute: missing channel_id in payload')
    if (!reply)     throw new Error('teams execute: missing reply in payload')

    const token = await getAccessToken()
    await postReply(token, teamId, channelId, messageId, reply)

    console.log(`[teams] replied to message ${messageId} in team ${teamId}`)
  },
}
