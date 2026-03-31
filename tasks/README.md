# Better Automation Hub — Implementation Plan

A personal automation system with a hosted Kanban UI, a self-hosted Postgres database, and a local Claude agent that executes tasks using MCP servers.

## Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router) |
| Hosting | Self-hosted VPS via Coolify + Nixpacks (Docker) |
| Reverse proxy | Traefik (Coolify default) |
| Database | Postgres, hosted on Coolify |
| ORM | Drizzle ORM |
| Local agent | Node.js process on your machine |
| Auth | NextAuth v5 with GitHub OAuth |
| Realtime | Server-Sent Events (SSE) from Next.js API |
| Agent → DB | Direct Postgres connection (service credentials) |
| Claude access | Claude API — MCP servers passed as tools |

## v1 Integrations

- Work email (Outlook) — via Softeria ms-365-mcp-server
- Microsoft Teams — via Softeria ms-365-mcp-server
- GitHub — new issues, new PRs, PR comments, mentions

## Repository structure

```
claude-automation-hub/
├── apps/
│   └── web/                  # Next.js app (frontend + API routes)
│       ├── app/
│       │   ├── board/        # Kanban UI
│       │   ├── config/       # Trigger + category config
│       │   └── api/          # REST + SSE endpoints
│       ├── lib/
│       │   ├── db/           # Drizzle schema + client
│       │   └── auth.ts       # NextAuth config
│       └── components/
├── packages/
│   └── agent/                # Local Node.js agent
│       └── src/
│           ├── integrations/ # Outlook, Teams, GitHub
│           └── ...
├── drizzle/
│   └── migrations/           # Generated SQL migrations
└── docs/                     # This plan
```

## Documents in this plan

| File | Contents |
|---|---|
| `01-database.md` | Postgres schema (Drizzle), migrations, Coolify setup |
| `02-kanban-ui.md` | Frontend components, pages, SSE wiring |
| `03-rest-api.md` | Next.js API routes + SSE endpoint spec |
| `04-local-agent.md` | Node agent architecture, MCP + Claude API, scheduling |
| `05-sync.md` | SSE push, action queue polling, agent↔DB connection |
| `06-auth.md` | NextAuth v5 + GitHub OAuth + middleware |
| `07-config-system.md` | Prompt templates, variable reference, config UI |
| `08-integrations.md` | Outlook, Teams, GitHub — which MCP tools, agent code |
| `09-deployment.md` | Coolify deploy, Nixpacks, env vars, agent startup |
| `10-milestones.md` | 5 phases, ~10 day estimate, build order |

## High-level data flow

```
[Outlook / Teams / GitHub]
        ↓ (MCP server on local machine)
[Local agent — cron schedule]
        ↓ (Claude API call with MCP tools + prompt template)
        ↓ (writes card directly to Postgres)
[Postgres on Coolify VPS]
        ↓ (Next.js SSE endpoint streams to browser)
[Kanban UI shows new card]
        ↓ (you edit draft + click Send)
[POST /api/actions — inserts to action_queue]
        ↓ (local agent polls action_queue every 10s)
[Agent executes via MCP — sends Outlook reply / Teams message]
        ↓ (agent updates card status = done)
[SSE pushes update to UI — card moves to Done]
```
