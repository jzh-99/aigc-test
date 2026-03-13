import { Skeleton } from '@/components/ui/skeleton'

export default function DashboardLoading() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Title */}
      <Skeleton className="h-7 w-24" />

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>

      {/* Content area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <Skeleton className="h-5 w-20" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <div>
          <Skeleton className="h-5 w-20 mb-3" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      </div>
    </div>
  )
}
