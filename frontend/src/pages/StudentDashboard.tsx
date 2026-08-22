import { useEffect, useState, useCallback } from "react";
import { apiRequest, ApiError } from "../lib/apiClient";
import { useAuth } from "../context/AuthContext";
import type { ContentItem, ContentType, Subscription } from "../types";
import DashboardHeader from "../components/student/DashboardHeader";
import StatCards from "../components/student/StatCards";
import ContentTabs from "../components/student/ContentTabs";
import ContentCard from "../components/content/ContentCard";
import VideoPlayerModal from "../components/content/VideoPlayerModal";
import PdfViewerModal from "../components/content/PdfViewerModal";
import PostViewerModal from "../components/content/PostViewerModal";
import { ErrorState, EmptyState } from "../components/common/States";
import { StatCardsSkeleton, CardGridSkeleton } from "../components/common/Skeleton";

export default function StudentDashboard() {
  const { user } = useAuth();
  const [tab, setTab] = useState<ContentType | "ALL">("ALL");
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [upcoming, setUpcoming] = useState<ContentItem[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [progress, setProgress] = useState({ overallPercent: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ContentItem | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [contentRes, upcomingRes, planRes, progressRes] = await Promise.all([
        apiRequest<{ content: ContentItem[] }>(`/content${tab !== "ALL" ? `?type=${tab}` : ""}`),
        apiRequest<{ content: ContentItem[] }>("/content/upcoming"),
        apiRequest<{ subscription: Subscription | null }>("/me/plan"),
        apiRequest<{ overallPercent: number; total: number }>("/me/progress"),
      ]);
      setItems(contentRes.content);
      setUpcoming(upcomingRes.content);
      setSubscription(planRes.subscription);
      setProgress({ overallPercent: progressRes.overallPercent, total: progressRes.total });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard right now.");
    }
  }, [tab]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  function openContent(item: ContentItem) {
    setActive(item);
  }

  function closeAndRefresh() {
    setActive(null);
    load();
  }

  return (
    <div className="min-h-screen bg-paper-50 pb-20">
      <DashboardHeader subscription={subscription} />

      <main className="mx-auto max-w-6xl px-5 py-8">
        <h1 className="font-display text-2xl font-semibold text-ink-950">Hello, {user?.name?.split(" ")[0]}</h1>
        <p className="mt-1 text-sm text-ink-500">Here's what's available to you right now.</p>

        <div className="mt-6">
          {items === null && !error ? (
            <StatCardsSkeleton />
          ) : (
            <StatCards
              overallPercent={progress.overallPercent}
              totalItems={items?.length ?? progress.total}
              planName={subscription?.plan.name ?? "None"}
            />
          )}
        </div>

        {!subscription && (
          <div className="mt-6 rounded-xl2 border border-amber-400/40 bg-amber-400/10 px-5 py-4 text-sm text-amber-700">
            You don't have an active plan yet, so content is locked. Contact your admin or check the plans on the landing page.
          </div>
        )}

        {upcoming.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-display text-lg font-semibold text-ink-950">Upcoming</h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {upcoming.map((item) => (
                <div key={item.id} className="min-w-[220px] rounded-xl2 border border-dashed border-ink-300 bg-white p-4">
                  <p className="text-xs font-medium text-amber-600">
                    {item.scheduledAt && new Date(item.scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                  <p className="mt-1 truncate font-medium text-ink-900">{item.title}</p>
                  <p className="text-xs text-ink-500">{item.course?.title}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-display text-lg font-semibold text-ink-950">Content</h2>
            <ContentTabs active={tab} onChange={setTab} />
          </div>

          {items === null && !error && <CardGridSkeleton count={6} />}
          {error && <ErrorState message={error} onRetry={load} />}
          {items && items.length === 0 && (
            <EmptyState
              title="Nothing here yet"
              description={subscription ? "New content will show up here as it's published." : "Get a plan to unlock content."}
            />
          )}
          {items && items.length > 0 && (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <ContentCard key={item.id} item={item} onOpen={openContent} />
              ))}
            </div>
          )}
        </section>
      </main>

      {active?.type === "VIDEO" && <VideoPlayerModal content={active} onClose={closeAndRefresh} />}
      {active?.type === "PDF" && <PdfViewerModal content={active} onClose={closeAndRefresh} />}
      {active?.type === "POST" && <PostViewerModal content={active} onClose={closeAndRefresh} />}
    </div>
  );
}
