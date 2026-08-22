// Skeleton loading primitives. Shapes mirror the real content they stand in
// for, so the page doesn't "pop" or reflow once data arrives.

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-ink-900/8 ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** Stat cards row — mirrors StatCards / OverviewSection card grid. */
export function StatCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading stats">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Media/content card grid — mirrors ContentCard / CourseShowcase cards. */
export function CardGridSkeleton({ count = 6, withMedia = true }: { count?: number; withMedia?: boolean }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card">
          {withMedia && <Skeleton className="aspect-video w-full rounded-none" />}
          <div className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-4 w-3/4" />
            <SkeletonText lines={2} className="mt-2" />
            <Skeleton className="mt-4 h-9 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Pricing-style card grid — mirrors landing/admin plan cards. */
export function PlanCardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-3" aria-busy="true" aria-label="Loading plans">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl2 border border-ink-900/8 bg-white p-6 shadow-card">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-28" />
          <SkeletonText lines={2} className="mt-3" />
          <div className="mt-5 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="mt-6 h-10 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * Data table skeleton. Renders a real (disabled) table on larger screens and
 * a stacked card list on small screens, matching the responsive pattern used
 * by the actual admin tables once loaded.
 */
export function TableSkeleton({ columns = 4, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {/* Mobile: stacked cards */}
      <div className="space-y-3 sm:hidden">
        {Array.from({ length: Math.min(rows, 4) }).map((_, i) => (
          <div key={i} className="rounded-xl2 border border-ink-900/8 bg-white p-4 shadow-card">
            <Skeleton className="h-4 w-2/3" />
            <SkeletonText lines={2} className="mt-2.5" />
          </div>
        ))}
      </div>

      {/* Desktop/tablet: table */}
      <div className="hidden overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-900/8">
            <tr>
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="px-5 py-3">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-900/8">
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                {Array.from({ length: columns }).map((_, c) => (
                  <td key={c} className="px-5 py-4">
                    <Skeleton className={`h-3 ${c === 0 ? "w-32" : "w-16"}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Settings-style form skeleton — mirrors SiteContentSection's stacked section cards. */
export function FormSectionsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl2 border border-ink-900/8 bg-white p-6 shadow-card">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-64" />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A short activity/log list — mirrors OverviewSection's recent-activity list. */
export function ListRowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-ink-900/8 rounded-xl2 border border-ink-900/8 bg-white shadow-card" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-5 py-3.5">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}
