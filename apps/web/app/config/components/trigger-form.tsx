'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Category } from './category-list'
import type { Trigger } from './trigger-list'

const SCHEDULE_PRESETS = [
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Every hour',       value: '0 * * * *' },
  { label: 'Every 6 hours',    value: '0 */6 * * *' },
  { label: 'Every day at 9am', value: '0 9 * * *' },
  { label: 'Custom…',          value: 'custom' },
]

const TEMPLATE_VARS: Record<string, string[]> = {
  outlook: ['{{content}}', '{{subject}}', '{{from}}', '{{date}}', '{{thread_id}}'],
  teams:   ['{{content}}', '{{date}}', '{{thread_id}}', '{{channel}}', '{{team}}'],
  github:  ['{{content}}', '{{date}}', '{{repo}}', '{{issue_title}}', '{{author}}', '{{event_type}}'],
}

const GITHUB_WATCH_EVENTS = ['issues', 'prs', 'pr_comments', 'mentions'] as const

const inputClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
  'placeholder:text-muted-foreground disabled:opacity-50'

export function TriggerForm({
  trigger,
  categories,
  onSaved,
  onClose,
}: {
  trigger: Trigger | null
  categories: Category[]
  onSaved: () => void
  onClose: () => void
}) {
  const isEdit = trigger !== null

  const initialSchedule = trigger?.schedule ?? '*/15 * * * *'
  const initialPreset =
    SCHEDULE_PRESETS.find((p) => p.value === initialSchedule && p.value !== 'custom')
      ?.value ?? 'custom'

  const cfg = (trigger?.integrationConfig ?? {}) as Record<string, unknown>

  const [name, setName]                 = useState(trigger?.name ?? '')
  const [integration, setIntegration]   = useState<'outlook' | 'teams' | 'github'>(trigger?.integration ?? 'outlook')
  const [categoryId, setCategoryId]     = useState(trigger?.categoryId ?? categories[0]?.id ?? '')
  const [preset, setPreset]             = useState(initialPreset)
  const [schedule, setSchedule]         = useState(initialSchedule)
  const [promptTemplate, setPrompt]     = useState(trigger?.promptTemplate ?? '')
  const [enabled, setEnabled]           = useState(trigger?.enabled ?? true)
  const [teamsTeamId, setTeamsTeamId]   = useState((cfg.team_id as string) ?? '')
  const [teamsChannel, setTeamsChannel] = useState((cfg.channel_id as string) ?? '')
  const [ghOwner, setGhOwner]           = useState((cfg.owner as string) ?? '')
  const [ghRepo, setGhRepo]             = useState((cfg.repo as string) ?? '')
  const [ghEvents, setGhEvents]         = useState<string[]>(
    Array.isArray(cfg.watch_events) ? (cfg.watch_events as string[]) : ['issues', 'prs']
  )
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const handlePresetChange = (value: string) => {
    setPreset(value)
    if (value !== 'custom') setSchedule(value)
  }

  const toggleGhEvent = (ev: string) =>
    setGhEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    )

  const buildConfig = (): Record<string, unknown> => {
    if (integration === 'teams') return { team_id: teamsTeamId, channel_id: teamsChannel }
    if (integration === 'github') return { owner: ghOwner, repo: ghRepo, watch_events: ghEvents }
    return {}
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !promptTemplate.trim() || !categoryId) {
      setError('Name, category, and prompt template are required.')
      return
    }
    setSaving(true)
    setError(null)
    const body = {
      name: name.trim(),
      integration,
      category_id: categoryId,
      schedule,
      prompt_template: promptTemplate,
      integration_config: buildConfig(),
      enabled,
    }
    try {
      const res = isEdit
        ? await fetch(`/api/triggers/${trigger.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/triggers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to save')
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleRunNow = async () => {
    if (!trigger) return
    await fetch(`/api/triggers/${trigger.id}/run`, { method: 'POST' })
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit trigger' : 'New trigger'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          {/* Name */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Inbox triage"
              className={inputClass}
              required
            />
          </div>

          {/* Integration */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Integration</label>
            <Select
              value={integration}
              onValueChange={(v) => setIntegration(v as typeof integration)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="outlook">Outlook</SelectItem>
                <SelectItem value="teams">Teams</SelectItem>
                <SelectItem value="github">GitHub</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Category</label>
            <Select value={categoryId} onValueChange={(v) => v && setCategoryId(v)}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Schedule */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Schedule</label>
            <Select value={preset} onValueChange={handlePresetChange}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCHEDULE_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset === 'custom' && (
              <input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="*/15 * * * *"
                className={`${inputClass} mt-1 font-mono`}
              />
            )}
          </div>

          {/* Conditional integration config */}
          {integration === 'teams' && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">Teams config</p>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Team ID</label>
                <input
                  value={teamsTeamId}
                  onChange={(e) => setTeamsTeamId(e.target.value)}
                  placeholder="Team ID from Teams URL"
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Channel ID</label>
                <input
                  value={teamsChannel}
                  onChange={(e) => setTeamsChannel(e.target.value)}
                  placeholder="Channel ID"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {integration === 'github' && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">GitHub config</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Owner</label>
                  <input
                    value={ghOwner}
                    onChange={(e) => setGhOwner(e.target.value)}
                    placeholder="org or username"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Repo</label>
                  <input
                    value={ghRepo}
                    onChange={(e) => setGhRepo(e.target.value)}
                    placeholder="repository name"
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Watch events</p>
                <div className="flex flex-wrap gap-3">
                  {GITHUB_WATCH_EVENTS.map((ev) => (
                    <label key={ev} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ghEvents.includes(ev)}
                        onChange={() => toggleGhEvent(ev)}
                        className="rounded"
                      />
                      {ev}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Prompt template */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Prompt template</label>
            <Textarea
              value={promptTemplate}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are triaging emails. Subject: {{subject}}…"
              rows={6}
              className="resize-none text-sm font-mono"
            />
            <div className="flex flex-wrap gap-1 mt-1">
              {(TEMPLATE_VARS[integration] ?? []).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPrompt((prev) => prev + v)}
                  className="text-xs px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 font-mono transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Enabled */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm">Enabled</span>
          </label>

          {/* Actions */}
          <div className="flex gap-2 pt-2 flex-wrap">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            {isEdit && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleRunNow}
                className="ml-auto"
              >
                &#9654; Run now
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
