import { StatCardsSkeleton, UpcomingCoursesSkeleton, ListRowsSkeleton, Skeleton } from "./Skeleton";

// Full-page skeletons that mirror the real header + first section of each
// dashboard. Used in two places that must look identical: (1) App.tsx,
// while the auth session is still being checked on a hard reload, and
// (2) each dashboard's own component, while its own data is still being
// fetched. Sharing one component means the page never flashes a "half
// real, half skeleton" state — the real header/greeting only ever appears
// once the whole page is ready to show real data alongside it.

export function StudentDashboardSkeletonShell() {
  return (
    <div className="min-h-screen bg-paper-50 pb-20">
      <header className="sticky top-0 z-30 border-b border-ink-900/8 bg-paper-50/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <span className="font-display text-lg font-semibold text-ink-950">Coursewell</span>
          <div className="h-9 w-9 animate-pulse rounded-full bg-gray-300" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
        <div className="mt-6">
          <StatCardsSkeleton />
        </div>
        <section className="mt-8">
          <Skeleton className="mb-3 h-3 w-32" />
          <UpcomingCoursesSkeleton />
        </section>
      </main>
    </div>
  );
}

export function AdminPanelSkeletonShell() {
  return (
    <div className="min-h-screen bg-paper-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-ink-900/8 bg-white px-5 py-3">
        <span className="font-display text-lg font-semibold text-ink-950">Coursewell Admin</span>
        <div className="h-8 w-8 animate-pulse rounded-full bg-gray-300" />
      </header>
      <div className="mx-auto flex max-w-7xl flex-col md:flex-row">
        <nav className="flex gap-1 overflow-x-auto border-b border-ink-900/8 bg-white px-3 py-2 md:w-56 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full shrink-0 rounded-lg md:mb-1" />
          ))}
        </nav>
        <main className="flex-1 px-5 py-6 md:px-8 md:py-8">
          <Skeleton className="h-6 w-32" />
          <div className="mt-5">
            <StatCardsSkeleton count={6} />
          </div>
          <Skeleton className="mt-8 h-5 w-56" />
          <div className="mt-3">
            <ListRowsSkeleton />
          </div>
        </main>
      </div>
    </div>
  );
}
