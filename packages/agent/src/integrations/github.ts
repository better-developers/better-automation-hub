import type { triggers } from '../../../../apps/web/lib/db/schema'
import type { FetchedItem, McpServerConfig } from '../claude-runner'
import type { Integration } from '../trigger-runner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Trigger = typeof triggers.$inferSelect

interface GitHubIssue {
  number: number
  title: string
  body: string | null
  html_url: string
  created_at: string
  updated_at: string
  user: { login: string }
  pull_request?: unknown // present on PRs returned by issues endpoint
}

interface GitHubComment {
  id: number
  html_url: string
  body: string | null
  created_at: string
  updated_at: string
  user: { login: string }
  issue_url?: string  // present on issue comments
}

interface GitHubPullRequest {
  number: number
  title: string
  body: string | null
  html_url: string
  created_at: string
  updated_at: string
  user: { login: string }
}

// ---------------------------------------------------------------------------
// GitHub REST API helpers
// ---------------------------------------------------------------------------

const GITHUB_BASE = 'https://api.github.com'

function githubHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN env var is not set')

  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function githubGet<T>(path: string): Promise<T> {
  const res = await fetch(`${GITHUB_BASE}${path}`, { headers: githubHeaders() })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub GET ${path} failed: ${res.status} — ${body}`)
  }

  return res.json() as Promise<T>
}

async function githubPost(path: string, payload: unknown): Promise<void> {
  const res = await fetch(`${GITHUB_BASE}${path}`, {
    method: 'POST',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub POST ${path} failed: ${res.status} — ${body}`)
  }
}

// ---------------------------------------------------------------------------
// Fetch helpers per event type
// ---------------------------------------------------------------------------

async function fetchIssues(
  owner: string,
  repo: string,
  since: Date | null,
  isPR: boolean,
): Promise<FetchedItem[]> {
  let path = `/repos/${owner}/${repo}/issues?state=open&per_page=25&sort=created&direction=desc`
  if (since) path += `&since=${since.toISOString()}`

  const issues = await githubGet<GitHubIssue[]>(path)

  return issues
    .filter((i) => isPR ? !!i.pull_request : !i.pull_request)
    .map((i) => ({
      externalId: `${isPR ? 'pr' : 'issue'}-${owner}-${repo}-${i.number}`,
      templateVars: {
        content:     i.body ?? '',
        date:        i.created_at,
        repo:        `${owner}/${repo}`,
        issue_title: i.title,
        author:      i.user.login,
        event_type:  isPR ? 'pull_request' : 'issue',
      },
      raw: i,
      actionMetadata: {
        owner,
        repo,
        issue_number: i.number,
        event_type:   isPR ? 'pull_request' : 'issue',
      },
    }))
}

async function fetchIssueComments(
  owner: string,
  repo: string,
  since: Date | null,
): Promise<FetchedItem[]> {
  let path = `/repos/${owner}/${repo}/issues/comments?per_page=25&sort=created&direction=desc`
  if (since) path += `&since=${since.toISOString()}`

  const comments = await githubGet<GitHubComment[]>(path)

  return comments.map((c) => {
    // issue_url looks like .../repos/owner/repo/issues/123
    const issueNumber = c.issue_url ? Number(c.issue_url.split('/').pop()) : undefined

    return {
      externalId: `comment-${owner}-${repo}-${c.id}`,
      templateVars: {
        content:     c.body ?? '',
        date:        c.created_at,
        repo:        `${owner}/${repo}`,
        issue_title: '',
        author:      c.user.login,
        event_type:  'pr_comment',
      },
      raw: c,
      actionMetadata: {
        owner,
        repo,
        issue_number: issueNumber,
        comment_id:   c.id,
        event_type:   'pr_comment',
      },
    }
  })
}

// ---------------------------------------------------------------------------
// execute — post a comment on an issue or PR
// ---------------------------------------------------------------------------

async function postComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  await githubPost(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body })
}

// ---------------------------------------------------------------------------
// Integration export
// ---------------------------------------------------------------------------

const mcpServers: McpServerConfig[] = process.env.GITHUB_MCP_URL
  ? [{ type: 'url', url: process.env.GITHUB_MCP_URL, name: 'github' }]
  : []

export const githubIntegration: Integration = {
  actionType: 'reply_github',
  mcpServers,

  async fetchNew(trigger: Trigger): Promise<FetchedItem[]> {
    const config = (trigger.integrationConfig ?? {}) as Record<string, unknown>

    const owner      = config.owner as string | undefined
    const repo       = config.repo as string | undefined
    const eventTypes = (config.event_types as string[] | undefined) ?? ['issues', 'prs']

    if (!owner || !repo) {
      console.warn('[github] integrationConfig missing owner or repo — skipping')
      return []
    }

    const since = trigger.lastRunAt ?? null
    const results: FetchedItem[] = []

    if (eventTypes.includes('issues')) {
      results.push(...(await fetchIssues(owner, repo, since, false)))
    }

    if (eventTypes.includes('prs')) {
      results.push(...(await fetchIssues(owner, repo, since, true)))
    }

    if (eventTypes.includes('pr_comments')) {
      results.push(...(await fetchIssueComments(owner, repo, since)))
    }

    return results
  },

  async execute(payload: Record<string, unknown>): Promise<void> {
    const owner       = payload.owner as string | undefined
    const repo        = payload.repo as string | undefined
    const issueNumber = payload.issue_number as number | undefined
    const reply       = (payload.reply ?? payload.draft_reply) as string | undefined

    if (!owner)       throw new Error('github execute: missing owner in payload')
    if (!repo)        throw new Error('github execute: missing repo in payload')
    if (!issueNumber) throw new Error('github execute: missing issue_number in payload')
    if (!reply)       throw new Error('github execute: missing reply in payload')

    await postComment(owner, repo, issueNumber, reply)

    console.log(`[github] commented on ${owner}/${repo}#${issueNumber}`)
  },
}
