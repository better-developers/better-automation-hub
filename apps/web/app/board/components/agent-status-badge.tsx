'use client'

import { useQuery } from '@tanstack/react-query'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted">
          <span
            className={`h-2 w-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span>{online ? 'Online' : 'Offline'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 text-sm">
        <p className="font-medium mb-2">Agent status</p>
        {data?.last_seen ? (
          <p className="text-muted-foreground mb-2">
            Last seen {data.seconds_ago}s ago
          </p>
        ) : (
          <p className="text-muted-foreground mb-2">Never connected</p>
        )}
        {data?.integrations && data.integrations.length > 0 ? (
          <>
            <p className="font-medium mb-1">Active integrations</p>
            <ul className="space-y-0.5">
              {data.integrations.map((i) => (
                <li key={i} className="capitalize text-muted-foreground">
                  {i}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted-foreground">No active integrations</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
