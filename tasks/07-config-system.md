# 07 — Config System

## Prompt template variables

| Variable | Integrations | Description |
|---|---|---|
| `{{content}}` | All | Full text body of the item |
| `{{subject}}` | Outlook | Email subject |
| `{{from}}` | Outlook | Sender name + address |
| `{{date}}` | All | ISO timestamp of the original item |
| `{{thread_id}}` | Outlook, Teams | Conversation/thread ID |
| `{{channel}}` | Teams | Channel name |
| `{{team}}` | Teams | Team name |
| `{{repo}}` | GitHub | `owner/repo` |
| `{{issue_title}}` | GitHub | Issue or PR title |
| `{{author}}` | GitHub | GitHub username of poster |
| `{{event_type}}` | GitHub | `issue` / `pr` / `pr_comment` / `mention` |

The prompt must instruct Claude to return **JSON only**:
```
{ "title": "...", "reply": "...", "summary": "..." }
```
This is what `claude-runner.ts` parses. If parsing fails, it falls back to treating the full response as the reply.

---

## Example prompt templates

### Outlook — work email scanner

```
You are an email assistant for Casper, a technical consultant at Better Developers in Aarhus.

Read the following email and write a professional reply in the same language as the email (Danish or English). Keep the reply short — max 4 sentences unless detail is truly needed.

From: {{from}}
Subject: {{subject}}
Date: {{date}}

Body:
{{content}}

Respond ONLY with valid JSON in this exact format — no markdown, no preamble:
{
  "title": "<subject line for the card, max 60 chars>",
  "summary": "<one sentence summary of the email, max 100 chars>",
  "reply": "<the reply body only — no greeting, no sign-off>"
}
```

### Teams — channel message scanner

```
You are an assistant for Casper. A new message arrived in a Microsoft Teams channel.

Team: {{team}}
Channel: {{channel}}
From: {{from}}
Date: {{date}}

Message:
{{content}}

Write a brief, friendly reply matching the tone of the message. 1–3 sentences.

Respond ONLY with valid JSON:
{
  "title": "<short description of the message, max 60 chars>",
  "summary": "<one sentence, max 100 chars>",
  "reply": "<reply body>"
}
```

### GitHub — issue and PR scanner

```
You are a developer assistant for Casper at Better Developers.

A new GitHub event was posted:
Repo: {{repo}}
Event type: {{event_type}}
Author: {{author}}
Title: {{issue_title}}

Content:
{{content}}

Write a short, helpful response (1–3 sentences). If it's a bug report, acknowledge and ask for clarification if needed. If it's a PR, note what you'll review.

Respond ONLY with valid JSON:
{
  "title": "<event description, max 60 chars>",
  "summary": "<one sentence, max 100 chars>",
  "reply": "<reply body>"
}
```

---

## Config UI — `/config`

### Layout

Two tabs: **Categories** and **Triggers**

### Categories tab

| Column | Type |
|---|---|
| Colour dot | Colour picker (click to change) |
| Name | Inline editable text |
| Card count | Read-only badge |
| ↕ | Drag handle for reordering |
| Delete | Button (disabled if column has cards) |

Add category button at the bottom.

### Triggers tab

Table columns: name, integration badge, category, schedule (friendly), last run (relative), enabled toggle, edit button.

### Trigger form fields

```
Name          [Scan work email                        ]
Integration   [Outlook ▼]
Category      [Work ▼]
Schedule      [Every 15 minutes ▼]   or   [Custom: */15 * * * *]
──── Integration-specific fields ─────────────────────
(Teams only)  Team ID    [abc123  ]
              Channel ID [def456  ]
(GitHub only) Repo       [better-developers/frokostportalen]
              Watch      [☑ New issues] [☑ New PRs] [☑ PR comments] [☑ Mentions]
──────────────────────────────────────────────────────
Prompt        [                                        ]
              [ large textarea                         ]
              [                                        ]
Variables: {{content}} {{from}} {{subject}} {{date}} …
Enabled       [● ON]
              [Save]  [Cancel]  [Run now ▶]
```

### Cron presets

| Label | Value |
|---|---|
| Every 5 minutes | `*/5 * * * *` |
| Every 15 minutes | `*/15 * * * *` |
| Every hour | `0 * * * *` |
| Every morning at 8am | `0 8 * * *` |
| Custom | (text input) |

### "Run now" button

`POST /api/triggers/:id/run` — inserts a `manual_run_requests` row. Agent checks this table on every heartbeat (30s) and fires the trigger immediately.

```sql
-- Add to schema
CREATE TABLE manual_run_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id UUID NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

In the agent's heartbeat:

```typescript
const pending = await db.select().from(manualRunRequests).limit(10)
for (const req of pending) {
  const trigger = await db.query.triggers.findFirst({ where: eq(triggers.id, req.triggerId) })
  if (trigger) await runTrigger(trigger)
  await db.delete(manualRunRequests).where(eq(manualRunRequests.id, req.id))
}
```

---

## Tasks checklist

- [ ] Categories CRUD in UI (inline edit, colour picker, drag-reorder)
- [ ] Trigger list with enable/disable toggle
- [ ] Trigger form with all fields
- [ ] Conditional integration config fields (Teams → team/channel, GitHub → repo + watch)
- [ ] Cron preset selector with custom fallback
- [ ] Prompt textarea with variable hint bar
- [ ] "Run now" button + `POST /api/triggers/:id/run` route
- [ ] `manual_run_requests` table + agent heartbeat check
