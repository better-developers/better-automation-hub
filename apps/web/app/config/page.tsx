import { eq, asc } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { categories, triggers } from '@/lib/db/schema'
import { ConfigTabs } from './components/config-tabs'
import type { Category } from './components/category-list'
import type { Trigger } from './components/trigger-list'

export default async function ConfigPage() {
  const session = await requireSession()
  const userId = session.user.id

  const [cats, trigs] = await Promise.all([
    db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.position)),
    db.select().from(triggers).where(eq(triggers.userId, userId)).orderBy(asc(triggers.createdAt)),
  ])

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4 flex items-center gap-4 shrink-0">
        <a
          href="/board"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr; Board
        </a>
        <h1 className="text-lg font-semibold">Config</h1>
      </header>
      <div className="flex-1 p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="rounded-lg border bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">AGENT_USER_ID</p>
            <p className="font-mono text-sm select-all">{userId}</p>
          </div>
          <ConfigTabs
            initialCategories={cats as unknown as Category[]}
            initialTriggers={trigs as unknown as Trigger[]}
          />
        </div>
      </div>
    </main>
  )
}
