import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";
import { formatIst } from "../../../../shared/frontend-core/lib/istTime";
import { useAuth } from "../../../auth/frontend/context/AuthContext";
import type { ContentItem, ContentType, Course, Subscription, Meeting, Quiz } from "../../../../shared/frontend-core/types/index";
import DashboardHeader from "../components/DashboardHeader";
import StatCards from "../components/StatCards";
import ContentTabs from "../components/ContentTabs";
import ContentCard from "../../../content/frontend/components/ContentCard";
import QuizCard from "../../../quiz/frontend/components/QuizCard";
import QuizTakeModal from "../../../quiz/frontend/components/QuizTakeModal";
import VideoPlayerModal from "../../../content/frontend/components/VideoPlayerModal";
import PdfViewerModal from "../../../content/frontend/components/PdfViewerModal";
import PostViewerModal from "../../../content/frontend/components/PostViewerModal";
import { ErrorState, EmptyState } from "../../../../shared/frontend-core/components/common/States";
import {
  StatCardsSkeleton,
  CardGridSkeleton,
  UpcomingCoursesSkeleton,
  UpcomingLessonsSkeleton,
} from "../../../../shared/frontend-core/components/common/Skeleton";
import { StudentDashboardSkeletonShell } from "../../../../shared/frontend-core/components/common/PageSkeletons";

export default function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ContentType | "ALL" | "QUIZ">("ALL");
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [takingQuizId, setTakingQuizId] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<ContentItem[] | null>(null);
  const [upcomingCourses, setUpcomingCourses] = useState<Course[] | null>(null);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [progress, setProgress] = useState({ overallPercent: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [upcomingCoursesError, setUpcomingCoursesError] = useState<string | null>(null);
  const [active, setActive] = useState<ContentItem | null>(null);
  // True once the very first load has settled (success or failure). Until
  // then we show one full-page skeleton (matching the shell shown during
  // the auth check) instead of the real header — otherwise the greeting
  // ("Hello, Name") renders immediately from the already-known user object
  // while the stats/content below are still skeletons, which reads as a
  // half-loaded page. Only gates the *first* load: later refreshes (tab
  // switches, closing a video) keep the real header and just skeleton the
  // section that's actually refetching.
  const initialLoadDoneRef = useRef(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    setError(null);
    // On a background refresh (e.g. after closing a video/PDF modal) keep
    // whatever's already on screen instead of blanking it back to a
    // skeleton — that data almost never changed, and re-flashing it every
    // time you close a piece of content just makes the page feel like it
    // reloads on every action.
    if (!opts.silent) {
      setUpcoming(null);
      setUpcomingCourses(null);
      setMeetings(null);
    }
    setUpcomingCoursesError(null);
    try {
      // Always fetch the full, unfiltered content feed — the tab filter
      // (All/Videos/PDFs/Posts/Quizzes) is applied client-side below via
      // visibleItems. Fetching once and filtering in-memory means
      // switching tabs is instant and doesn't refetch the whole
      // dashboard (upcoming items, courses, meetings, plan, progress,
      // quizzes) just because the active tab changed.
      const results = await Promise.allSettled([
        apiRequest<{ content: ContentItem[] }>("/content"),
        apiRequest<{ content: ContentItem[] }>("/content/upcoming"),
        apiRequest<{ courses: Course[] }>("/courses/upcoming"),
        apiRequest<{ meetings: Meeting[] }>("/meetings/upcoming"),
        apiRequest<{ subscription: Subscription | null }>("/me/plan"),
        apiRequest<{ overallPercent: number; total: number }>("/me/progress"),
        apiRequest<{ quizzes: Quiz[] }>("/quizzes"),
      ]);

      const [contentRes, upcomingRes, upcomingCoursesRes, meetingsRes, planRes, progressRes, quizzesRes] = results;
      if (contentRes.status === "rejected") throw contentRes.reason;
      if (planRes.status === "rejected") throw planRes.reason;
      if (progressRes.status === "rejected") throw progressRes.reason;

      setItems(contentRes.value.content);
      setSubscription(planRes.value.subscription);
      setProgress({ overallPercent: progressRes.value.overallPercent, total: progressRes.value.total });

      if (upcomingRes.status === "fulfilled") setUpcoming(upcomingRes.value.content);
      else setUpcoming([]);
      if (upcomingCoursesRes.status === "fulfilled") {
        setUpcomingCourses(upcomingCoursesRes.value.courses);
        setUpcomingCoursesError(null);
      } else {
        setUpcomingCourses([]);
        setUpcomingCoursesError(
          upcomingCoursesRes.reason instanceof ApiError
            ? upcomingCoursesRes.reason.message
            : "Upcoming courses are temporarily unavailable."
        );
      }
      if (meetingsRes.status === "fulfilled") setMeetings(meetingsRes.value.meetings);
      else setMeetings([]);
      if (quizzesRes.status === "fulfilled") setQuizzes(quizzesRes.value.quizzes);
      else setQuizzes([]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load your dashboard right now.");
    } finally {
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;
        setInitialLoadDone(true);
      }
    }
  }, []);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  // Client-side tab filter over the one unfiltered content fetch above —
  // switching tabs is just a re-render of already-loaded data, not a
  // new network request.
  const visibleItems = useMemo(() => {
    if (!items) return null;
    if (tab === "ALL" || tab === "QUIZ") return items;
    return items.filter((i) => i.type === tab);
  }, [items, tab]);

  function openContent(item: ContentItem) {
    setActive(item);
  }

  function closeAndRefresh() {
    setActive(null);
    load({ silent: true });
  }

  // Not loaded yet, and no error to show — keep this identical to the
  // shell shown during the auth check (App.tsx) so there's exactly one
  // skeleton state, then a direct swap to the real page once data lands.
  if (!initialLoadDone && !error) return <StudentDashboardSkeletonShell />;

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
              totalItems={progress.total}
              planName={subscription?.plan.name ?? "None"}
            />
          )}
        </div>

        {!subscription && (
          <div className="mt-6 rounded-xl2 border border-amber-400/40 bg-amber-400/10 px-5 py-4 text-sm text-amber-700">
            You don't have an active plan yet, so content is locked. Contact your admin or check the plans on the landing page.
          </div>
        )}

        {meetings && meetings.length > 0 && (
          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-amber-600">Live classes</p>
                <h2 className="mt-1 font-display text-lg font-semibold text-ink-950">Upcoming Meetings</h2>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {meetings.map((meeting) => (
                <article key={meeting.id} className="rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-amber-600">{meeting.course?.title}</p>
                      <h3 className="mt-1 font-display font-semibold text-ink-950">{meeting.title}</h3>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meeting.status === "LIVE" ? "bg-red-500/10 text-red-700" : "bg-ink-100 text-ink-600"}`}>{meeting.status}</span>
                  </div>
                  <p className="mt-3 text-sm text-ink-500">{meeting.description || "Live course meeting"}</p>
                  <p className="mt-3 text-xs font-medium text-ink-600">{formatIst(meeting.scheduledAt)}</p>
                  {meeting.status === "LIVE" ? (
                    <button onClick={() => navigate(`/meeting/${meeting.id}`)} className="mt-4 w-full rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-white">Join meeting</button>
                  ) : (
                    <button disabled className="mt-4 w-full rounded-full bg-ink-100 px-4 py-2 text-sm font-semibold text-ink-400">Waiting for teacher</button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {upcomingCourses === null && !error && (
          <section className="mt-8">
            <div className="mb-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-amber-600">Your learning path</p>
              <h2 className="mt-1 font-display text-lg font-semibold text-ink-950">Upcoming Courses</h2>
            </div>
            <UpcomingCoursesSkeleton count={3} />
          </section>
        )}

        {upcomingCourses !== null && (upcomingCourses.length > 0 || upcomingCoursesError) && (
          <section className="mt-8">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-amber-600">Your learning path</p>
                <h2 className="mt-1 font-display text-lg font-semibold text-ink-950">Upcoming Courses</h2>
              </div>
            </div>
            {upcomingCoursesError && (
              <p className="mb-3 text-sm text-ink-500" role="status">{upcomingCoursesError}</p>
            )}
            {upcomingCourses.length > 0 && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {upcomingCourses.map((course) => (
                <article key={course.id} className="overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card">
                  <div className="relative h-40 w-full overflow-hidden bg-ink-100">
                    {course.thumbnailUrl ? (
                      <img
                        src={course.thumbnailUrl}
                        alt=""
                        className="absolute inset-0 block h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center font-display text-2xl font-semibold text-ink-300">{course.title.slice(0, 1)}</div>
                    )}
                  </div>
                  <div className="p-4">
                    {course.category && <span className="rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">{course.category}</span>}
                    <h3 className="mt-2 font-display font-semibold text-ink-950">{course.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-500">{course.description}</p>
                    <p className="mt-3 text-xs font-medium text-amber-700">
                      Starts {course.startAt ? formatIst(course.startAt) : "soon"}
                    </p>
                  </div>
                </article>
              ))}
            </div>}
          </section>
        )}

        {upcoming === null && !error && (
          <section className="mt-8">
            <div className="mb-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-amber-600">Scheduled learning</p>
              <h2 className="mt-1 font-display text-lg font-semibold text-ink-950">Upcoming Lessons</h2>
            </div>
            <UpcomingLessonsSkeleton count={3} />
          </section>
        )}

        {upcoming !== null && upcoming.length > 0 && (
          <section className="mt-8">
            <div className="mb-3">
              <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-amber-600">Scheduled learning</p>
              <h2 className="mt-1 font-display text-lg font-semibold text-ink-950">Upcoming Lessons</h2>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {upcoming.map((item) => (
                <div key={item.id} className="min-w-[220px] rounded-xl2 border border-dashed border-ink-300 bg-white p-4">
                  <p className="text-xs font-medium text-amber-600">
                    {item.scheduledAt && formatIst(item.scheduledAt, { month: "short", day: "numeric" })}
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
            <h2 className="font-display text-lg font-semibold text-ink-950">{tab === "QUIZ" ? "Quizzes" : "Content"}</h2>
            <ContentTabs active={tab} onChange={setTab} />
          </div>

          {tab === "QUIZ" ? (
            <>
              {quizzes && quizzes.length > 0 && (
                <p className="mb-4 text-sm font-medium text-ink-500">
                  Quizzes: {quizzes.filter((q) => q.lastAttempt).length} / {quizzes.length} completed
                </p>
              )}
              {quizzes === null && !error && <CardGridSkeleton count={6} mediaClassName="h-40 w-full" />}
              {error && <ErrorState message={error} onRetry={load} />}
              {quizzes && quizzes.length === 0 && (
                <EmptyState
                  title="No quizzes yet"
                  description={subscription ? "Quizzes will show up here as they're published." : "Get a plan to unlock quizzes."}
                />
              )}
              {quizzes && quizzes.length > 0 && (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {quizzes.map((quiz) => (
                    <QuizCard key={quiz.id} quiz={quiz} onStart={(q) => setTakingQuizId(q.id)} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {visibleItems === null && !error && <CardGridSkeleton count={6} mediaClassName="h-40 w-full" />}
              {error && <ErrorState message={error} onRetry={load} />}
              {visibleItems && visibleItems.length === 0 && (
                <EmptyState
                  title="Nothing here yet"
                  description={subscription ? "New content will show up here as it's published." : "Get a plan to unlock content."}
                />
              )}
              {visibleItems && visibleItems.length > 0 && (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleItems.map((item) => (
                    <ContentCard key={item.id} item={item} onOpen={openContent} />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {active?.type === "VIDEO" && <VideoPlayerModal content={active} onClose={closeAndRefresh} />}
      {active?.type === "PDF" && <PdfViewerModal content={active} onClose={closeAndRefresh} />}
      {active?.type === "POST" && items && (
        <PostViewerModal
          items={items.filter((i) => i.type === "POST")}
          initialIndex={items.filter((i) => i.type === "POST").findIndex((i) => i.id === active.id)}
          onClose={closeAndRefresh}
        />
      )}
      {takingQuizId && (
        <QuizTakeModal
          quizId={takingQuizId}
          onClose={() => setTakingQuizId(null)}
          onCompleted={() => load({ silent: true })}
        />
      )}
    </div>
  );
}
