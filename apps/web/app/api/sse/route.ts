import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { sseEvents } from '@/lib/db/schema'
import { gt } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  let session: Awaited<ReturnType<typeof requireSession>>
  try {
    session = await requireSession()
  } catch (response) {
    return response as Response
  }

  const userId = session.user.id

  const lastEventIdHeader = request.headers.get('Last-Event-ID')
  let lastId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let keepAliveTimer: ReturnType<typeof setInterval> | null = null
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let closed = false

      function send(data: string) {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(data))
          } catch {
            closed = true
          }
        }
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
            .where(gt(sseEvents.id, lastId))
            .orderBy(sseEvents.id)
            .limit(50)

          for (const row of rows) {
            if (row.userId !== userId) continue
            lastId = row.id
            const data = `id: ${row.id}\nevent: ${row.eventType}\ndata: ${JSON.stringify(row.payload)}\n\n`
            send(data)
          }
        } catch {
          // DB errors shouldn't crash the stream
        }
      }, 2_000)

      // Clean up when the client disconnects
      request.signal.addEventListener('abort', () => {
        closed = true
        if (keepAliveTimer) clearInterval(keepAliveTimer)
        if (pollTimer) clearInterval(pollTimer)
        try { controller.close() } catch { /* already closed */ }
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
