'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { TriggerForm } from './trigger-form'
import type { Category } from './category-list'

export interface Trigger {
  id: string
  name: string
  integration: 'outlook' | 'teams' | 'github'
  categoryId: string
  schedule: string
  promptTemplate: string
  integrationConfig: Record<string, unknown>
  enabled: boolean
  lastRunAt: string | null
  createdAt: string
}

async function fetchTriggers(): Promise<Trigger[]> {
  const res = await fetch('/api/triggers')
  if (!res.ok) throw new Error('Failed to fetch triggers')
  return res.json().then((d: { triggers: Trigger[] }) => d.triggers)
}

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const INTEGRATION_STYLES: Record<string, string> = {
  outlook: 'bg-blue-100 text-blue-700',
  teams: 'bg-purple-100 text-purple-700',
  github: 'bg-gray-100 text-gray-700',
}

export function TriggerList({
  initialTriggers,
  initialCategories,
}: {
  initialTriggers: Trigger[]
  initialCategories: Category[]
}) {
  const queryClient = useQueryClient()
  const [formTrigger, setFormTrigger] = useState<Trigger | 'new' | null>(null)

  const { data: triggers = initialTriggers } = useQuery({
    queryKey: ['triggers'],
    queryFn: fetchTriggers,
    initialData: initialTriggers,
  })

  const { data: categories = initialCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await fetch('/api/categories')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json().then((d: { categories: Category[] }) => d.categories)
    },
    initialData: initialCategories,
  })

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const res = await fetch(`/api/triggers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      if (!res.ok) throw new Error('Failed to update')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triggers'] }),
  })

  const deleteTrigger = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/triggers/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['triggers'] }),
  })

  const runNow = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/triggers/${id}/run`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to queue run')
    },
  })

  return (
    <div className="space-y-4">
      {triggers.length === 0 && (
        <p className="text-sm text-muted-foreground py-4">
          No triggers yet — create one to start automating.
        </p>
      )}

      <div className="space-y-2">
        {triggers.map((trigger) => (
          <div
            key={trigger.id}
            className="flex items-start gap-3 rounded-lg border bg-background px-4 py-3"
          >
            {/* Enable / disable toggle */}
            <button
              role="switch"
              aria-checked={trigger.enabled}
              onClick={() =>
                toggleEnabled.mutate({ id: trigger.id, enabled: !trigger.enabled })
              }
              className={[
                'relative mt-0.5 flex-shrink-0 h-5 w-9 rounded-full transition-colors',
                trigger.enabled ? 'bg-primary' : 'bg-muted-foreground/30',
              ].join(' ')}
              title={trigger.enabled ? 'Disable' : 'Enable'}
            >
              <span
                className={[
                  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                  trigger.enabled ? 'translate-x-4' : 'translate-x-0',
                ].join(' ')}
              />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{trigger.name}</span>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    INTEGRATION_STYLES[trigger.integration] ?? ''
                  }`}
                >
                  {trigger.integration}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last run: {relativeTime(trigger.lastRunAt)}
                &nbsp;&middot;&nbsp;
                <code className="text-xs">{trigger.schedule}</code>
              </p>
            </div>

            <div className="flex gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => runNow.mutate(trigger.id)}
                title="Run now"
              >
                &#9654;
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setFormTrigger(trigger)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => deleteTrigger.mutate(trigger.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Button size="sm" onClick={() => setFormTrigger('new')}>
        + New trigger
      </Button>

      {formTrigger !== null && (
        <TriggerForm
          trigger={formTrigger === 'new' ? null : formTrigger}
          categories={categories}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['triggers'] })
            setFormTrigger(null)
          }}
          onClose={() => setFormTrigger(null)}
        />
      )}
    </div>
  )
}
