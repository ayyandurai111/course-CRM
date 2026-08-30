import { useEffect, useState, FormEvent, useRef } from "react";
import Modal from "../../../../shared/frontend-core/components/modals/Modal";
import { Field, inputClass, PrimaryButton } from "../../../../shared/frontend-core/components/forms/FormFields";
import { apiRequest, ApiError } from "../../../../shared/frontend-core/lib/apiClient";
import type { Course } from "../../../../shared/frontend-core/types/index";

function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const ACCEPTED_THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_THUMBNAIL_MB = 10;

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
  // thumbnailFile: a newly picked image waiting to be uploaded on submit.
  // thumbnailPreviewUrl: what to actually show in the preview box — a
  // local object URL for a freshly picked file, or the course's
  // existing thumbnail when editing and nothing new has been picked yet.
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState(course?.thumbnailUrl ?? "");
  const [startAt, setStartAt] = useState(() => toDateTimeLocal(course?.startAt));
  const [isPublished, setIsPublished] = useState(course?.isPublished ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStartAt(toDateTimeLocal(course?.startAt));
  }, [course?.id, course?.startAt]);

  // Revoke the local object URL when it's replaced or the modal unmounts,
  // so picking several thumbnails in a row doesn't leak memory.
  useEffect(() => {
    return () => {
      if (thumbnailPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(thumbnailPreviewUrl);
    };
  }, [thumbnailPreviewUrl]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED_THUMBNAIL_TYPES.includes(file.type)) {
      setError("Please choose a JPG, PNG, or WEBP image.");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_THUMBNAIL_MB * 1024 * 1024) {
      setError(`Image is too large — please choose one under ${MAX_THUMBNAIL_MB}MB.`);
      e.target.value = "";
      return;
    }

    setThumbnailFile(file);
    setThumbnailPreviewUrl(URL.createObjectURL(file));
  }

  function clearThumbnail() {
    setThumbnailFile(null);
    setThumbnailPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

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

      // Only upload if the admin actually picked a new file — editing an
      // existing course without touching the thumbnail should leave its
      // current thumbnailUrl untouched, not re-upload anything.
      let thumbnailUrl = course?.thumbnailUrl ?? undefined;
      if (thumbnailFile) {
        setUploadingThumbnail(true);
        const formData = new FormData();
        formData.append("file", thumbnailFile);
        const res = await apiRequest<{ thumbnailUrl: string }>("/courses/thumbnail", {
          method: "POST",
          body: formData,
          isFormData: true,
        });
        thumbnailUrl = res.thumbnailUrl;
        setUploadingThumbnail(false);
      } else if (!thumbnailPreviewUrl) {
        // The admin explicitly cleared the thumbnail.
        thumbnailUrl = undefined;
      }

      const body = { title: title.trim(), description: description.trim(), category: category.trim() || undefined, thumbnailUrl, startAt: startDate ? startDate.toISOString() : null, isPublished };
      if (course) {
        await apiRequest(`/courses/${course.id}`, { method: "PATCH", body });
      } else {
        await apiRequest("/courses", { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setUploadingThumbnail(false);
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
        <Field label="Thumbnail" htmlFor="c-thumb" hint="JPG, PNG, or WEBP, up to 10MB.">
          <div className="flex items-start gap-3">
            {thumbnailPreviewUrl && (
              <img
                src={thumbnailPreviewUrl}
                alt="Thumbnail preview"
                className="h-16 w-24 flex-shrink-0 rounded-lg border border-ink-900/15 object-cover"
              />
            )}
            <div className="flex-1">
              <input
                id="c-thumb"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className={`${inputClass} cursor-pointer file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-ink-950 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-paper-50`}
              />
              {thumbnailPreviewUrl && (
                <button
                  type="button"
                  onClick={clearThumbnail}
                  className="mt-1.5 text-xs font-medium text-ink-500 hover:text-ink-950"
                >
                  Remove thumbnail
                </button>
              )}
            </div>
          </div>
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
          <PrimaryButton disabled={saving}>
            {uploadingThumbnail ? "Uploading thumbnail…" : saving ? "Saving…" : "Save course"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
