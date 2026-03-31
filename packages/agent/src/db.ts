import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../../../apps/web/lib/db/schema'

const pgClient = postgres(process.env.DATABASE_URL!, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
})

export const db = drizzle(pgClient, { schema })
