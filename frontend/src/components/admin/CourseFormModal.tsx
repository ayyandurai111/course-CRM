import { useState, FormEvent } from "react";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";
import { apiRequest, ApiError } from "../../lib/apiClient";
import type { Course } from "../../types";

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
  const [isPublished, setIsPublished] = useState(course?.isPublished ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const body = { title, description, category: category || undefined, thumbnailUrl: thumbnailUrl || undefined, isPublished };
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
