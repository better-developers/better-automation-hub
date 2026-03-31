'use client'

import { useQuery } from '@tanstack/react-query'

interface AgentStatus {
  online: boolean
  last_seen: string | null
  seconds_ago: number | null
  integrations: string[]
}

export function AgentStatusBadge() {
  const { data } = useQuery<AgentStatus>({
    queryKey: ['agent-status'],
    queryFn: async () => {
      const res = await fetch('/api/agent/status')
      if (!res.ok) throw new Error('Failed to fetch agent status')
      return res.json()
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  const online = data?.online ?? false
  const integrations = data?.integrations ?? []
  const secondsAgo = data?.seconds_ago

  const tooltipLines = [
    online ? 'Agent online' : secondsAgo != null ? `Last seen ${secondsAgo}s ago` : 'Agent offline',
    integrations.length > 0 ? `Integrations: ${integrations.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
      title={tooltipLines}
      aria-label={online ? 'Agent online' : 'Agent offline'}
    >
      <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`} />
      <span>{online ? 'Online' : 'Offline'}</span>
    </span>
  )
}
