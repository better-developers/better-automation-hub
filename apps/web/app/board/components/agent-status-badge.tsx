'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface AgentStatus {
  online: boolean
  last_seen: string | null
  seconds_ago: number | null
  integrations: string[]
}

async function fetchAgentStatus(): Promise<AgentStatus> {
  const res = await fetch('/api/agent/status')
  if (!res.ok) throw new Error('Failed to fetch agent status')
  return res.json()
}

export function AgentStatusBadge() {
  const { data } = useQuery({
    queryKey: ['agent-status'],
    queryFn: fetchAgentStatus,
    refetchInterval: 30_000,
  })

  const online = data?.online ?? false

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 text-sm rounded-md px-2 py-1 hover:bg-muted transition-colors">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              online ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className={online ? 'text-green-700' : 'text-red-600'}>
            {online ? 'Online' : 'Offline'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 text-sm">
        <p className="font-medium mb-2">Agent status</p>
        {data?.last_seen ? (
          <p className="text-muted-foreground mb-2">
            Last seen {data.seconds_ago}s ago
          </p>
        ) : (
          <p className="text-muted-foreground mb-2">Never connected</p>
        )}
        {data && data.integrations.length > 0 && (
          <>
            <p className="font-medium mb-1">Active integrations</p>
            <ul className="list-disc pl-4 text-muted-foreground">
              {data.integrations.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
