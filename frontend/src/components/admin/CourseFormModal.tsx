import { useEffect, useState, FormEvent } from "react";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { Course } from "../../types";

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function CourseFormModal({
  course,
  onClose,
  onSaved,
}: {
  course: Course | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(course?.title ?? "");
  const [description, setDescription] = useState(course?.description ?? "");
  const [category, setCategory] = useState(course?.category ?? "");
  const [thumbnailUrl, setThumbnailUrl] = useState(course?.thumbnailUrl ?? "");
  const [startAt, setStartAt] = useState(() => toDateTimeLocal(course?.startAt));
  const [isPublished, setIsPublished] = useState(course?.isPublished ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStartAt(toDateTimeLocal(course?.startAt));
  }, [course?.id, course?.startAt]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const startDate = startAt ? new Date(startAt) : null;
      if (startDate && Number.isNaN(startDate.getTime())) {
        setError("Please enter a valid course start date and time.");
        return;
      }
      const body = { title: title.trim(), description: description.trim(), category: category.trim() || undefined, thumbnailUrl: thumbnailUrl.trim() || undefined, startAt: startDate ? startDate.toISOString() : null, isPublished };
      if (course) {
        await apiRequest(`/courses/${course.id}`, { method: "PATCH", body });
      } else {
        await apiRequest("/courses", { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this course.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={course ? "Edit course" : "New course"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Title" htmlFor="c-title">
          <input id="c-title" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description" htmlFor="c-desc">
          <textarea
            id="c-desc"
            required
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Category" htmlFor="c-cat">
          <input id="c-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Thumbnail URL" htmlFor="c-thumb">
          <input id="c-thumb" value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Course start date & time" htmlFor="c-start" hint="Optional. Set this to show the course in students' Upcoming Courses. The time is saved with timezone information.">
          <input
            id="c-start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className={inputClass}
          />
        </Field>
        <label className="mb-5 flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={isPublished} onChange={(e) => setIsPublished(e.target.checked)} />
          Published (visible on the landing page)
        </label>

        {error && <p className="mb-4 text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-medium text-ink-700">
            Cancel
          </button>
          <PrimaryButton disabled={saving}>{saving ? "Saving…" : "Save course"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
