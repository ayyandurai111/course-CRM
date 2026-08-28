import { StatCardsSkeleton, UpcomingCoursesSkeleton, ListRowsSkeleton, Skeleton } from "./Skeleton";

/** Dark-surface pulse block for skeletons that sit on the meeting room's
 *  ink-950 background, where the light-mode gray-300 Skeleton would look
 *  out of place. Kept local to this file since it's the only dark shell. */
function DarkSkeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-white/10 ${className}`} aria-hidden="true" />;
}

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

/**
 * Full-page skeleton for the live meeting room, shown by MeetingPage while
 * the join token is being fetched. Mirrors MeetingRoom.tsx's actual layout
 * (dark header, participant tile grid, bottom control bar) so joining a
 * class reads as "connecting" rather than a generic blank/spinner screen,
 * and so there's no reflow once the real room mounts.
 */
export function MeetingRoomSkeletonShell({ participantCount = 3 }: { participantCount?: number }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-white" aria-busy="true">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <DarkSkeleton className="h-4 w-40" />
          <DarkSkeleton className="mt-2 h-3 w-24" />
        </div>
        <div className="flex items-center gap-2">
          <DarkSkeleton className="h-7 w-16 rounded-full" />
          <DarkSkeleton className="h-8 w-20 rounded-full" />
          <DarkSkeleton className="hidden h-8 w-14 rounded-full sm:block" />
        </div>
      </header>

      <main className="flex min-h-0 flex-1 gap-3 p-3 sm:p-5">
        <div className="mx-auto grid h-fit w-full max-w-7xl flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: participantCount }).map((_, i) => (
            <div key={i} className="relative aspect-video overflow-hidden rounded-2xl bg-white/5">
              <DarkSkeleton className="absolute inset-0 rounded-2xl" />
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/40 px-2.5 py-1">
                <DarkSkeleton className="h-2.5 w-2.5 rounded-full" />
                <DarkSkeleton className="h-2.5 w-16" />
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-white/10 bg-ink-950/95 px-3 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2 sm:gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <DarkSkeleton key={i} className="h-11 w-24 rounded-full sm:w-28" />
          ))}
        </div>
      </footer>
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
