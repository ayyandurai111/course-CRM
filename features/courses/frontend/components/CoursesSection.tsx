import { useEffect, useState } from "react";
import { apiRequest, ApiError, reportActionError } from "../../../../shared/frontend-core/lib/apiClient";
import { formatIst } from "../../../../shared/frontend-core/lib/istTime";
import type { Course } from "../../../../shared/frontend-core/types/index";
import { ErrorState, EmptyState } from "../../../../shared/frontend-core/components/common/States";
import { TableSkeleton } from "../../../../shared/frontend-core/components/common/Skeleton";
import CourseFormModal from "./CourseFormModal";
import { PlusIcon } from "../../../../shared/frontend-core/components/common/Icons";

type AdminCourse = Course & { _count: { content: number } };

export default function CoursesSection() {
  const [courses, setCourses] = useState<AdminCourse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Course | null | "new">(null);

  async function load() {
    setError(null);
    try {
      const data = await apiRequest<{ courses: AdminCourse[] }>("/courses/admin");
      setCourses(data.courses);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load courses.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this course? Its content will be removed too.")) return;
    try {
      await apiRequest(`/courses/${id}`, { method: "DELETE" });
      load();
    } catch (err) {
      reportActionError(err, "Couldn't delete this course.");
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold text-ink-950">Courses</h1>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-900"
        >
          <PlusIcon className="h-4 w-4" />
          Add course
        </button>
      </div>

      {courses === null && !error && <TableSkeleton columns={5} rows={5} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {courses && courses.length === 0 && (
        <EmptyState
          title="No courses yet"
          description="Create your first course to start publishing content."
          action={
            <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50">
              <PlusIcon className="h-4 w-4" />
              Add course
            </button>
          }
        />
      )}

      {courses && courses.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {courses.map((c) => (
              <div key={c.id} className="rounded-xl2 border border-ink-900/8 bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-ink-900">{c.title}</p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      c.isPublished ? "bg-emerald-500/10 text-emerald-700" : "bg-ink-100 text-ink-500"
                    }`}
                  >
                    {c.isPublished ? "Published" : "Unpublished"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink-500">
                  {c.category || "No category"} · {c._count.content} content item{c._count.content === 1 ? "" : "s"}
                </p>
                <div className="mt-3 flex gap-4 border-t border-ink-900/8 pt-3">
                  <button onClick={() => setEditing(c)} className="text-sm font-medium text-ink-700 hover:text-ink-950">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="text-sm font-medium text-red-600 hover:text-red-700">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Tablet/desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-900/8 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Content</th>
                  <th className="px-5 py-3 font-medium">Starts</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/8">
                {courses.map((c) => (
                  <tr key={c.id}>
                    <td className="px-5 py-3 font-medium text-ink-900">{c.title}</td>
                    <td className="px-5 py-3 text-ink-500">{c.category || "—"}</td>
                    <td className="px-5 py-3 text-ink-500">{c._count.content}</td>
                    <td className="px-5 py-3 text-ink-500">{c.startAt ? formatIst(c.startAt) : "—"}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          c.isPublished ? "bg-emerald-500/10 text-emerald-700" : "bg-ink-100 text-ink-500"
                        }`}
                      >
                        {c.isPublished ? "Published" : "Unpublished"}
                      </span>
                    </td>
                    <td className="space-x-3 px-5 py-3 text-right">
                      <button onClick={() => setEditing(c)} className="font-medium text-ink-700 hover:text-ink-950">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(c.id)} className="font-medium text-red-600 hover:text-red-700">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <CourseFormModal
          course={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
