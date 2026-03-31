import { NextRequest } from 'next/server'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { sseEvents } from '@/lib/db/schema'
import { gt, and, eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let session: Awaited<ReturnType<typeof requireSession>>
  try {
    session = await requireSession()
  } catch (res) {
    return res as Response
  }

  const userId = session.user.id

  const lastEventIdHeader = req.headers.get('Last-Event-ID')
  let lastId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false

      const send = (data: string) => {
        if (!closed) {
          controller.enqueue(encoder.encode(data))
        }
      }

      // Send initial connection comment
      send(': connected\n\n')

      let keepAliveTimer: ReturnType<typeof setInterval>
      let pollTimer: ReturnType<typeof setInterval>

      const cleanup = () => {
        closed = true
        clearInterval(keepAliveTimer)
        clearInterval(pollTimer)
      }

      // Keep-alive every 25s
      keepAliveTimer = setInterval(() => {
        send(': keep-alive\n\n')
      }, 25_000)

      // Poll sse_events every 2s
      pollTimer = setInterval(async () => {
        if (closed) return
        try {
          const rows = await db
            .select()
            .from(sseEvents)
            .where(
              and(
                eq(sseEvents.userId, userId),
                gt(sseEvents.id, lastId)
              )
            )
            .orderBy(sseEvents.id)

          for (const row of rows) {
            send(`id: ${row.id}\nevent: ${row.eventType}\ndata: ${JSON.stringify(row.payload)}\n\n`)
            lastId = row.id
          }
        } catch {
          // DB error — keep connection alive, will retry next poll
        }
      }, 2_000)

      // Detect client disconnect
      req.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
