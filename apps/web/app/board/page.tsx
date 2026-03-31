import { eq, asc } from 'drizzle-orm'
import { requireSession } from '@/lib/auth-guard'
import { db } from '@/lib/db/client'
import { categories, cards } from '@/lib/db/schema'
import { KanbanBoard } from './components/kanban-board'

export default async function BoardPage() {
  const session = await requireSession()
  const userId = session.user.id

  const [categoriesData, cardsData] = await Promise.all([
    db.select().from(categories).where(eq(categories.userId, userId)).orderBy(asc(categories.position)),
    db.select().from(cards).where(eq(cards.userId, userId)).orderBy(asc(cards.position)),
  ])

  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-semibold">Claude Automation Hub</h1>
        <a href="/config" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          Config
        </a>
      </header>
      <div className="flex-1 overflow-hidden p-6">
        <KanbanBoard
          initialCategories={categoriesData}
          initialCards={cardsData as Parameters<typeof KanbanBoard>[0]['initialCards']}
        />
      </div>
    </main>
  )
}
