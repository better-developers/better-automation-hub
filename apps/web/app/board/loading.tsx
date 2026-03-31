import { Skeleton } from '@/components/ui/skeleton'

function SkeletonColumn({ cardCount }: { cardCount: number }) {
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-muted/50 p-3">
      {/* Column header */}
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-3 w-3 rounded-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="ml-auto h-4 w-5" />
      </div>
      {/* Cards */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: cardCount }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-3 shadow-sm">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="mt-1 h-4 w-3/4" />
            <Skeleton className="mt-2 h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function BoardLoading() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between shrink-0">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-12" />
      </header>
      <div className="flex-1 overflow-hidden p-6">
        <div className="flex gap-4 overflow-x-auto pb-4 px-1">
          <SkeletonColumn cardCount={3} />
          <SkeletonColumn cardCount={2} />
          <SkeletonColumn cardCount={4} />
        </div>
      </div>
    </main>
  )
}
