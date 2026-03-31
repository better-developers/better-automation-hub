import { db } from './db/client'
import { sseEvents } from './db/schema'

export async function emitSseEvent(
  userId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(sseEvents).values({ userId, eventType, payload })
}
