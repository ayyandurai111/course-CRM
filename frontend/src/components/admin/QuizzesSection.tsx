import { useEffect, useState } from "react";
import { apiRequest, ApiError, reportActionError } from "../../lib/apiClient";
import type { Course, Quiz, QuizStatus } from "../../types";
import { ErrorState, EmptyState } from "../common/States";
import { TableSkeleton } from "../common/Skeleton";
import { PlusIcon, UploadIcon, HelpCircleIcon, AwardIcon } from "../common/Icons";
import QuizFormModal from "./QuizFormModal";
import QuizImportModal from "./QuizImportModal";
import QuizBuilder from "./QuizBuilder";
import QuizResultsView from "./QuizResultsView";

// A quiz's own `status` (DRAFT/PUBLISHED) reuses ContentStatus's pill
// styling via StatusPill, but that component's type is keyed to the
// 5-value ContentStatus union. Rather than widen that shared component
// for a 2-value union it otherwise never sees, a tiny local pill keeps
// the visual language consistent without touching StatusPill.tsx.
function QuizStatusPill({ status }: { status: QuizStatus }) {
  const cfg =
    status === "PUBLISHED"
      ? { label: "Published", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" }
      : { label: "Draft", className: "bg-ink-100 text-ink-700 border-ink-300/60" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

type View = { mode: "list" } | { mode: "builder"; quizId: string } | { mode: "results"; quizId: string; quizTitle: string };

export default function QuizzesSection() {
  const [quizzes, setQuizzes] = useState<Quiz[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<QuizStatus | "">("");
  const [courseFilter, setCourseFilter] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<View>({ mode: "list" });

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (courseFilter) params.set("courseId", courseFilter);
      if (search) params.set("search", search);
      const data = await apiRequest<{ quizzes: Quiz[] }>(`/quizzes/admin?${params.toString()}`);
      setQuizzes(data.quizzes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load quizzes.");
    }
  }

  useEffect(() => {
    apiRequest<{ courses: Course[] }>("/courses/admin").then((d) => setCourses(d.courses)).catch(() => {});
  }, []);

  useEffect(() => {
    if (view.mode !== "list") return;
    setQuizzes(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, courseFilter, search, view.mode]);

  async function handleDelete(quiz: Quiz) {
    if (!confirm(`Delete "${quiz.title}"? This also deletes every student's attempt history for it. This cannot be undone.`)) return;
    try {
      await apiRequest(`/quizzes/${quiz.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      reportActionError(err, "Couldn't delete this quiz.");
    }
  }

  if (view.mode === "builder") {
    return <QuizBuilder quizId={view.quizId} onBack={() => setView({ mode: "list" })} onViewResults={(quizTitle) => setView({ mode: "results", quizId: view.quizId, quizTitle })} />;
  }
  if (view.mode === "results") {
    return <QuizResultsView quizId={view.quizId} quizTitle={view.quizTitle} onBack={() => setView({ mode: "builder", quizId: view.quizId })} />;
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold text-ink-950">Quizzes</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setImporting(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink-900/15 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-100"
          >
            <UploadIcon className="h-4 w-4" />
            Import from Word
          </button>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-900"
          >
            <PlusIcon className="h-4 w-4" />
            Create Quiz
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 rounded-lg border border-ink-900/15 px-3 py-2 text-sm sm:col-span-1"
        />
        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="rounded-lg border border-ink-900/15 px-3 py-2 text-sm">
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as QuizStatus | "")} className="rounded-lg border border-ink-900/15 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
        </select>
      </div>

      {quizzes === null && !error && <TableSkeleton columns={5} rows={5} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {quizzes && quizzes.length === 0 && (
        <EmptyState
          title="No quizzes match these filters"
          description="Create a quiz manually, or import one from a Word document."
          action={
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50">
              <PlusIcon className="h-4 w-4" />
              Create Quiz
            </button>
          }
        />
      )}

      {quizzes && quizzes.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {quizzes.map((quiz) => (
              <button
                key={quiz.id}
                onClick={() => setView({ mode: "builder", quizId: quiz.id })}
                className="block w-full rounded-xl2 border border-ink-900/8 bg-white p-4 text-left shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate font-medium text-ink-900">{quiz.title}</p>
                  <QuizStatusPill status={quiz.status} />
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-500">
                  <HelpCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  {quiz.questionCount ?? 0} question{(quiz.questionCount ?? 0) === 1 ? "" : "s"} · {quiz.course?.title}
                </p>
              </button>
            ))}
          </div>

          {/* Tablet/desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-900/8 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Course</th>
                  <th className="px-5 py-3 font-medium">Questions</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/8">
                {quizzes.map((quiz) => (
                  <tr key={quiz.id} className="hover:bg-ink-100/40">
                    <td className="max-w-[260px] truncate px-5 py-3 font-medium text-ink-900">
                      <button onClick={() => setView({ mode: "builder", quizId: quiz.id })} className="hover:underline">
                        {quiz.title}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{quiz.course?.title}</td>
                    <td className="px-5 py-3 text-ink-500">{quiz.questionCount ?? 0}</td>
                    <td className="px-5 py-3">
                      <QuizStatusPill status={quiz.status} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => setView({ mode: "results", quizId: quiz.id, quizTitle: quiz.title })} className="inline-flex items-center gap-1 text-xs font-medium text-ink-700 hover:underline">
                          <AwardIcon className="h-3.5 w-3.5" />
                          Results
                        </button>
                        <button onClick={() => setView({ mode: "builder", quizId: quiz.id })} className="text-xs font-medium text-ink-700 hover:underline">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(quiz)} className="text-xs font-medium text-red-600 hover:underline">
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {creating && (
        <QuizFormModal
          courses={courses}
          onClose={() => setCreating(false)}
          onSaved={(quiz) => {
            setCreating(false);
            setView({ mode: "builder", quizId: quiz.id });
          }}
        />
      )}
      {importing && (
        <QuizImportModal
          courses={courses}
          onClose={() => setImporting(false)}
          onImported={(quiz) => {
            setImporting(false);
            setView({ mode: "builder", quizId: quiz.id });
          }}
        />
      )}
    </div>
  );
}
