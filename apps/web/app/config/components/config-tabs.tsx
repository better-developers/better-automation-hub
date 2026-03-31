'use client'

import { useState } from 'react'
import { CategoryList } from './category-list'
import { TriggerList } from './trigger-list'
import type { Category } from './category-list'
import type { Trigger } from './trigger-list'

export function ConfigTabs({
  initialCategories,
  initialTriggers,
}: {
  initialCategories: Category[]
  initialTriggers: Trigger[]
}) {
  const [tab, setTab] = useState<'categories' | 'triggers'>('categories')

  return (
    <div>
      <div className="flex border-b mb-6">
        {(['categories', 'triggers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium capitalize transition-colors -mb-px border-b-2',
              tab === t
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'categories' ? (
        <CategoryList initialCategories={initialCategories} />
      ) : (
        <TriggerList
          initialTriggers={initialTriggers}
          initialCategories={initialCategories}
        />
      )}
    </div>
  )
}
