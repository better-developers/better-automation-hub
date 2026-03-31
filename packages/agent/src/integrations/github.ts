import type { triggers } from '../../../../apps/web/lib/db/schema'
import type { FetchedItem, Integration, McpServerConfig } from '../claude-runner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubIssue {
  id: number
  number: number
  title: string
  body: string | null
  user: { login: string } | null
  created_at: string
  html_url: string
  pull_request?: unknown  // present when the issue is actually a PR
}

interface GitHubPR {
  id: number
  number: number
  title: string
  body: string | null
  user: { login: string } | null
  created_at: string
  html_url: string
}

interface GitHubIssueComment {
  id: number
  body: string
  user: { login: string } | null
  created_at: string
  html_url: string
  issue_url: string  // e.g. https://api.github.com/repos/owner/repo/issues/42
}

interface GitHubPRComment {
  id: number
  body: string
  user: { login: string } | null
  created_at: string
  html_url: string
  pull_request_url: string  // e.g. https://api.github.com/repos/owner/repo/pulls/7
}

type WatchEvent = 'issues' | 'prs' | 'pr_comments' | 'issue_comments'

type Trigger = typeof triggers.$inferSelect

// ---------------------------------------------------------------------------
// GitHub REST helpers
// ---------------------------------------------------------------------------

const GITHUB_API = 'https://api.github.com'

async function ghGet<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${GITHUB_API}${path}`, { headers })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub GET ${path} failed: ${res.status} — ${body}`)
  }
  return res.json() as Promise<T>
}

async function ghPost(path: string, payload: unknown): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN is not set')

  const res = await fetch(`${GITHUB_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
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

async function fetchNewIssues(
  owner: string,
  repo: string,
  since: Date | null,
): Promise<FetchedItem[]> {
  let path = `/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=25`
  if (since) path += `&since=${since.toISOString()}`

  const items = await ghGet<GitHubIssue[]>(path)
  // Exclude PRs (GitHub returns them mixed with issues)
  return items
    .filter((i) => !i.pull_request)
    .map((issue) => ({
      externalId: `issue-${issue.number}`,
      templateVars: {
        content:     issue.body ?? '',
        date:        issue.created_at,
        repo:        `${owner}/${repo}`,
        issue_title: issue.title,
        author:      issue.user?.login ?? '',
        event_type:  'issue',
      },
      raw: issue,
      actionMetadata: {
        owner,
        repo,
        issue_number: issue.number,
        event_type:   'issue',
      },
    }))
}

async function fetchNewPRs(
  owner: string,
  repo: string,
  since: Date | null,
): Promise<FetchedItem[]> {
  const path = `/repos/${owner}/${repo}/pulls?state=open&sort=created&direction=desc&per_page=25`
  const items = await ghGet<GitHubPR[]>(path)

  const cutoff = since ? since.getTime() : 0
  return items
    .filter((pr) => new Date(pr.created_at).getTime() > cutoff)
    .map((pr) => ({
      externalId: `pr-${pr.number}`,
      templateVars: {
        content:     pr.body ?? '',
        date:        pr.created_at,
        repo:        `${owner}/${repo}`,
        issue_title: pr.title,
        author:      pr.user?.login ?? '',
        event_type:  'pr',
      },
      raw: pr,
      actionMetadata: {
        owner,
        repo,
        issue_number: pr.number,  // GitHub comments API uses issue_number for PRs too
        event_type:   'pr',
      },
    }))
}

async function fetchNewIssueComments(
  owner: string,
  repo: string,
  since: Date | null,
): Promise<FetchedItem[]> {
  let path = `/repos/${owner}/${repo}/issues/comments?sort=created&direction=desc&per_page=25`
  if (since) path += `&since=${since.toISOString()}`

  const items = await ghGet<GitHubIssueComment[]>(path)
  return items.map((comment) => {
    // Extract issue number from issue_url
    const issueNumber = parseInt(comment.issue_url.split('/').pop() ?? '0', 10)
    return {
      externalId: `issue-comment-${comment.id}`,
      templateVars: {
        content:     comment.body,
        date:        comment.created_at,
        repo:        `${owner}/${repo}`,
        issue_title: '',
        author:      comment.user?.login ?? '',
        event_type:  'issue_comment',
      },
      raw: comment,
      actionMetadata: {
        owner,
        repo,
        issue_number: issueNumber,
        event_type:   'issue_comment',
      },
    }
  })
}

async function fetchNewPRComments(
  owner: string,
  repo: string,
  since: Date | null,
): Promise<FetchedItem[]> {
  let path = `/repos/${owner}/${repo}/pulls/comments?sort=created&direction=desc&per_page=25`
  if (since) path += `&since=${since.toISOString()}`

  const items = await ghGet<GitHubPRComment[]>(path)
  return items.map((comment) => {
    const prNumber = parseInt(comment.pull_request_url.split('/').pop() ?? '0', 10)
    return {
      externalId: `pr-comment-${comment.id}`,
      templateVars: {
        content:     comment.body,
        date:        comment.created_at,
        repo:        `${owner}/${repo}`,
        issue_title: '',
        author:      comment.user?.login ?? '',
        event_type:  'pr_comment',
      },
      raw: comment,
      actionMetadata: {
        owner,
        repo,
        issue_number: prNumber,
        event_type:   'pr_comment',
      },
    }
  })
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
    const owner = typeof config.owner === 'string' ? config.owner : ''
    const repo  = typeof config.repo  === 'string' ? config.repo  : ''

    if (!owner || !repo) {
      throw new Error('github fetchNew: missing owner or repo in integrationConfig')
    }

    // Default: watch issues + PRs; allow override via integrationConfig.watch_events
    const watchEvents: WatchEvent[] = Array.isArray(config.watch_events)
      ? (config.watch_events as WatchEvent[])
      : ['issues', 'prs']

    const since = trigger.lastRunAt
    const results: FetchedItem[] = []

    if (watchEvents.includes('issues')) {
      results.push(...(await fetchNewIssues(owner, repo, since)))
    }
    if (watchEvents.includes('prs')) {
      results.push(...(await fetchNewPRs(owner, repo, since)))
    }
    if (watchEvents.includes('issue_comments')) {
      results.push(...(await fetchNewIssueComments(owner, repo, since)))
    }
    if (watchEvents.includes('pr_comments')) {
      results.push(...(await fetchNewPRComments(owner, repo, since)))
    }

    return results
  },

  async execute(payload: Record<string, unknown>): Promise<void> {
    const owner       = payload.owner        as string | undefined
    const repo        = payload.repo         as string | undefined
    const issueNumber = payload.issue_number as number | undefined
    const reply       = (payload.reply ?? payload.draft_reply) as string | undefined

    if (!owner)       throw new Error('github execute: missing owner in payload')
    if (!repo)        throw new Error('github execute: missing repo in payload')
    if (!issueNumber) throw new Error('github execute: missing issue_number in payload')
    if (!reply)       throw new Error('github execute: missing reply in payload')

    await ghPost(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, { body: reply })

    console.log(`[github] posted comment on ${owner}/${repo}#${issueNumber}`)
  },
}
