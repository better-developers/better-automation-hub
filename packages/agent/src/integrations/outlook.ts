import { eq } from 'drizzle-orm'
import { authAccounts } from '../../../../apps/web/lib/db/schema'
import type { triggers } from '../../../../apps/web/lib/db/schema'
import { db } from '../db'
import type { FetchedItem, Integration, McpServerConfig } from '../claude-runner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphEmailAddress {
  name: string
  address: string
}

interface GraphMessage {
  id: string
  subject: string
  from: { emailAddress: GraphEmailAddress }
  receivedDateTime: string
  body: { content: string; contentType: string }
  conversationId: string
  isRead: boolean
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
// fetchNew — list unread emails and map to FetchedItem[]
// ---------------------------------------------------------------------------

async function fetchUnreadEmails(
  token: string,
  maxEmails: number,
): Promise<GraphMessage[]> {
  const select = 'id,subject,from,receivedDateTime,body,conversationId,isRead'
  const filter = encodeURIComponent('isRead eq false')
  const path =
    `/me/messages` +
    `?$filter=${filter}` +
    `&$orderby=receivedDateTime+desc` +
    `&$top=${maxEmails}` +
    `&$select=${select}`

  const data = await graphGet<{ value: GraphMessage[] }>(token, path)
  return data.value ?? []
}

// ---------------------------------------------------------------------------
// execute — send a reply to an email via MS Graph
// ---------------------------------------------------------------------------

async function sendReply(
  token: string,
  messageId: string,
  replyText: string,
): Promise<void> {
  await graphPost(token, `/me/messages/${messageId}/reply`, {
    message: {},
    comment: replyText,
  })
}

// ---------------------------------------------------------------------------
// Integration export
// ---------------------------------------------------------------------------

const mcpServers: McpServerConfig[] = process.env.MS365_MCP_URL
  ? [{ type: 'url', url: process.env.MS365_MCP_URL, name: 'ms365' }]
  : []

export const outlookIntegration: Integration = {
  actionType: 'reply_email',
  mcpServers,

  async fetchNew(trigger: Trigger): Promise<FetchedItem[]> {
    const token = await getAccessToken()
    const config = (trigger.integrationConfig ?? {}) as Record<string, unknown>
    const maxEmails = typeof config.max_emails === 'number' ? config.max_emails : 20

    const messages = await fetchUnreadEmails(token, maxEmails)

    return messages.map((msg) => ({
      externalId: msg.id,
      templateVars: {
        subject:   msg.subject ?? '',
        from:      msg.from?.emailAddress?.address ?? '',
        date:      msg.receivedDateTime ?? '',
        content:   msg.body?.content ?? '',
        thread_id: msg.conversationId ?? '',
      },
      raw: msg,
      actionMetadata: {
        message_id: msg.id,
        thread_id:  msg.conversationId,
        from:       msg.from?.emailAddress?.address,
        subject:    msg.subject,
      },
    }))
  },

  async execute(payload: Record<string, unknown>): Promise<void> {
    const messageId = payload.message_id as string | undefined
    const reply = (payload.reply ?? payload.draft_reply) as string | undefined

    if (!messageId) throw new Error('outlook execute: missing message_id in payload')
    if (!reply) throw new Error('outlook execute: missing reply in payload')

    const token = await getAccessToken()
    await sendReply(token, messageId, reply)

    console.log(`[outlook] replied to message ${messageId}`)
  },
}
