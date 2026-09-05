import { useEffect, useState } from "react";
import { apiRequest, ApiError, reportActionError } from "../../../../shared/frontend-core/lib/apiClient";
import { formatIst } from "../../../../shared/frontend-core/lib/istTime";
import type { Course, ContentItem, ContentStatus, ContentType } from "../../../../shared/frontend-core/types/index";
import { ErrorState, EmptyState } from "../../../../shared/frontend-core/components/common/States";
import { TableSkeleton } from "../../../../shared/frontend-core/components/common/Skeleton";
import StatusPill from "../../../../shared/frontend-core/components/common/StatusPill";
import ContentTypeBadge from "../../../../shared/frontend-core/components/common/ContentTypeBadge";
import LiveRecordingBadge from "../../../../shared/frontend-core/components/common/LiveRecordingBadge";
import ContentFormModal from "./ContentFormModal";
import ScheduleModal from "../../../courses/frontend/components/ScheduleModal";
import { MoreVerticalIcon, PlusIcon } from "../../../../shared/frontend-core/components/common/Icons";

// Only these actions are ever valid for a given status (mirrors backend
// contentService transitions) — the row menu never offers a dead end.
const ACTIONS_BY_STATUS: Record<ContentStatus, string[]> = {
  DRAFT: ["edit", "publish", "schedule", "delete"],
  SCHEDULED: ["edit", "publish", "reschedule", "delete"],
  PUBLISHED: ["edit", "unpublish", "archive"],
  UNPUBLISHED: ["edit", "publish", "schedule", "archive", "delete"],
  ARCHIVED: ["delete"],
};

const ACTION_LABELS: Record<string, string> = {
  edit: "Edit",
  publish: "Publish now",
  schedule: "Schedule",
  reschedule: "Reschedule",
  unpublish: "Unpublish",
  archive: "Archive",
  delete: "Delete",
};

export default function ContentSection() {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ContentStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<ContentType | "">("");
  const [courseFilter, setCourseFilter] = useState("");
  const [search, setSearch] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ContentItem | null | "new">(null);
  const [scheduling, setScheduling] = useState<ContentItem | null>(null);

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("type", typeFilter);
      if (courseFilter) params.set("courseId", courseFilter);
      if (search) params.set("search", search);
      const data = await apiRequest<{ content: ContentItem[] }>(`/content/admin?${params.toString()}`);
      setItems(data.content);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load content.");
    }
  }

  useEffect(() => {
    apiRequest<{ courses: Course[] }>("/courses/admin").then((d) => setCourses(d.courses)).catch(() => {});
  }, []);

  useEffect(() => {
    setItems(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter, courseFilter, search]);

  async function handleAction(item: ContentItem, action: string) {
    setOpenMenuId(null);
    if (action === "edit") return setEditing(item);
    if (action === "schedule" || action === "reschedule") return setScheduling(item);
    if (action === "delete") {
      if (!confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
      try {
        await apiRequest(`/content/${item.id}`, { method: "DELETE" });
        await load();
      } catch (err) {
        reportActionError(err, "Couldn't delete this content.");
      }
      return;
    }
    // publish / unpublish / archive
    try {
      await apiRequest(`/content/${item.id}/${action}`, { method: "POST" });
      load();
    } catch (err) {
      reportActionError(err, "That action isn't valid right now.");
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold text-ink-950">Content</h1>
        <button
          onClick={() => setEditing("new")}
          className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50 hover:bg-ink-900"
        >
          <PlusIcon className="h-4 w-4" />
          Add content
        </button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="col-span-2 rounded-lg border border-ink-900/15 px-3 py-2 text-sm sm:col-span-1"
        />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ContentType | "")} className="rounded-lg border border-ink-900/15 px-3 py-2 text-sm">
          <option value="">All types</option>
          <option value="VIDEO">Video</option>
          <option value="PDF">PDF</option>
          <option value="POST">Post</option>
        </select>
        <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="rounded-lg border border-ink-900/15 px-3 py-2 text-sm">
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ContentStatus | "")} className="rounded-lg border border-ink-900/15 px-3 py-2 text-sm">
          <option value="">All statuses</option>
          {["DRAFT", "SCHEDULED", "PUBLISHED", "UNPUBLISHED", "ARCHIVED"].map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {items === null && !error && <TableSkeleton columns={6} rows={6} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {items && items.length === 0 && (
        <EmptyState
          title="No content matches these filters"
          action={
            <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-paper-50">
              <PlusIcon className="h-4 w-4" />
              Add content
            </button>
          }
        />
      )}

      {items && items.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {items.map((item) => (
              <div key={item.id} className="rounded-xl2 border border-ink-900/8 bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <p className="truncate font-medium text-ink-900">{item.title}</p>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                      className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100"
                      aria-label={`Actions for ${item.title}`} aria-expanded={openMenuId === item.id} aria-haspopup="menu"
                    >
                      <MoreVerticalIcon className="h-4 w-4" />
                    </button>
                    {openMenuId === item.id && (
                      <div role="menu" className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-xl border border-ink-900/8 bg-white text-left shadow-card">
                        {ACTIONS_BY_STATUS[item.status].map((action) => (
                          <button
                            key={action}
                            onClick={() => handleAction(item, action)}
                            className={`block w-full px-4 py-2 text-sm hover:bg-ink-100 ${
                              action === "delete" ? "text-red-600" : "text-ink-700"
                            }`}
                          >
                            {ACTION_LABELS[action]}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <ContentTypeBadge type={item.type} />
                  {item.source === "RECORDING" && <LiveRecordingBadge />}
                  <StatusPill status={item.status} />
                </div>
                <p className="mt-2 text-sm text-ink-500">
                  {item.course?.title}
                  {(item.status === "SCHEDULED" ? item.scheduledAt : item.publishedAt) && (
                    <>
                      {" "}
                      ·{" "}
                      {formatIst(
                        (item.status === "SCHEDULED" ? item.scheduledAt : item.publishedAt) as string,
                        { dateStyle: "medium" }
                      )}
                    </>
                  )}
                </p>
              </div>
            ))}
          </div>

          {/* Tablet/desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-900/8 text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Title</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Course</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-900/8">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="max-w-[220px] truncate px-5 py-3 font-medium text-ink-900">{item.title}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ContentTypeBadge type={item.type} />
                        {item.source === "RECORDING" && <LiveRecordingBadge />}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink-500">{item.course?.title}</td>
                    <td className="px-5 py-3">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="px-5 py-3 text-ink-500">
                      {item.status === "SCHEDULED"
                        ? item.scheduledAt && formatIst(item.scheduledAt, { dateStyle: "medium" })
                        : item.publishedAt
                        ? formatIst(item.publishedAt, { dateStyle: "medium" })
                        : "—"}
                    </td>
                    <td className="relative px-5 py-3 text-right">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === item.id ? null : item.id)}
                        className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100"
                        aria-label={`Actions for ${item.title}`} aria-expanded={openMenuId === item.id} aria-haspopup="menu"
                      >
                        <MoreVerticalIcon className="h-4 w-4" />
                      </button>
                      {openMenuId === item.id && (
                        <div role="menu" className="absolute right-5 z-10 mt-1 w-40 overflow-hidden rounded-xl border border-ink-900/8 bg-white text-left shadow-card">
                          {ACTIONS_BY_STATUS[item.status].map((action) => (
                            <button
                              key={action}
                              onClick={() => handleAction(item, action)}
                              className={`block w-full px-4 py-2 text-sm hover:bg-ink-100 ${
                                action === "delete" ? "text-red-600" : "text-ink-700"
                              }`}
                            >
                              {ACTION_LABELS[action]}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <ContentFormModal
          content={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {scheduling && (
        <ScheduleModal
          content={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={() => {
            setScheduling(null);
            load();
          }}
        />
      )}
    </div>
  );
}
