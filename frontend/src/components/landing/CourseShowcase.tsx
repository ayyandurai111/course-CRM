import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { Course, SiteContent } from "../../types";
import { ErrorState, EmptyState } from "../common/States";
import { CardGridSkeleton } from "../common/Skeleton";

export default function CourseShowcase({ content }: { content: SiteContent["courseShowcase"] }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setCourses(null);
    try {
      const data = await apiRequest<{ courses: Course[] }>("/courses");
      setCourses(data.courses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load courses right now.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section id="courses" className="mx-auto max-w-6xl px-5 py-20">
      <div className="mb-10 max-w-lg">
        <p className="font-mono text-xs font-medium uppercase tracking-widest text-amber-600">{content.eyebrow}</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-950">
          {content.title}
        </h2>
      </div>

      {courses === null && !error && <CardGridSkeleton count={3} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {courses && courses.length === 0 && (
        <EmptyState title="No courses published yet" description="Check back soon — new courses are added regularly." />
      )}

      {courses && courses.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <article
              key={course.id}
              className="flex flex-col overflow-hidden rounded-xl2 border border-ink-900/8 bg-white shadow-card"
            >
              <div className="aspect-[16/10] w-full bg-ink-100">
                {course.thumbnailUrl ? (
                  <img src={course.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center font-display text-2xl font-semibold text-ink-300">
                    {course.title.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col p-5">
                {course.category && (
                  <span className="mb-2 w-fit rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-500">
                    {course.category}
                  </span>
                )}
                <h3 className="font-display text-lg font-semibold text-ink-950">{course.title}</h3>
                <p className="mt-1.5 line-clamp-2 flex-1 text-sm text-ink-500">{course.description}</p>
                {course.contentCounts && (
                  <p className="mt-4 font-mono text-xs text-ink-500">
                    {course.contentCounts.VIDEO} Videos • {course.contentCounts.PDF} PDFs • {course.contentCounts.POST} Posts
                  </p>
                )}
                <a
                  href="#plans"
                  className="mt-4 inline-block rounded-full border border-ink-900/15 px-4 py-2 text-center text-sm font-semibold text-ink-900 transition hover:border-ink-900/30"
                >
                  View course
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
