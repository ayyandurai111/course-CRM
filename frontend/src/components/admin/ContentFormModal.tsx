import { useState, FormEvent, useEffect } from "react";
import Modal from "../modals/Modal";
import { Field, inputClass, PrimaryButton } from "../forms/FormFields";
import { apiRequest, ApiError } from "../../lib/apiClient";
import { useProtectedFile } from "../../hooks/useProtectedFile";
import VideoThumbnailPicker from "./VideoThumbnailPicker";
import type { Course, ContentItem, ContentType } from "../../types";

export default function ContentFormModal({
  content,
  onClose,
  onSaved,
}: {
  content: ContentItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState(content?.title ?? "");
  const [description, setDescription] = useState(content?.description ?? "");
  const [type, setType] = useState<ContentType>(content?.type ?? "VIDEO");
  const [courseId, setCourseId] = useState(content?.courseId ?? "");
  const [imageUrl, setImageUrl] = useState(content?.imageUrl ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  // Local preview URL for a freshly-picked (not yet uploaded) video file,
  // so the admin can pick a thumbnail frame from it before saving.
  const [localVideoUrl, setLocalVideoUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file && type === "VIDEO") {
      const url = URL.createObjectURL(file);
      setLocalVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setLocalVideoUrl(null);
  }, [file, type]);

  // For editing existing video content without replacing the file, load a
  // protected playback URL so the same frame-picker can scrub the video
  // that's already attached instead of only supporting brand-new uploads.
  const existingVideoContentId = !file && type === "VIDEO" && content?.hasFile ? content.id : null;
  const { url: existingVideoUrl } = useProtectedFile(existingVideoContentId);
  const videoSrc = type === "VIDEO" ? localVideoUrl || existingVideoUrl : null;

  useEffect(() => {
    apiRequest<{ courses: Course[] }>("/courses/admin")
      .then((d) => setCourses(d.courses))
      .catch(() => {});
  }, []);

  async function uploadFile(): Promise<{ contentId: string; fileKey: string; fileSizeBytes: number } | null> {
    if (!file || !courseId) return null;
    setUploadProgress("Uploading file…");
    // Field order matters here: multer's fileFilter reads req.body.type
    // the moment it hits the file part in the multipart stream, so the
    // text fields must be appended (and therefore sent) before the file
    // field or they won't be parsed yet when fileFilter runs.
    const formData = new FormData();
    formData.append("type", type);
    formData.append("courseId", courseId);
    formData.append("file", file);
    const res = await apiRequest<{ contentId: string; fileKey: string; fileSizeBytes: number }>(`/upload`, {
      method: "POST",
      body: formData,
      isFormData: true,
    });
    setUploadProgress(null);
    return res;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      let fileData: { contentId: string; fileKey: string; fileSizeBytes: number } | null = null;
      if ((type === "VIDEO" || type === "PDF" || type === "POST") && file) {
        fileData = await uploadFile();
      }

      const body: Record<string, unknown> = {
        title,
        description: description || undefined,
        type,
        courseId,
        // Only fall back to a raw external URL when no file was uploaded
        // for this POST — an uploaded file always wins since it's the
        // access-controlled path (private storage + signed URL), while
        // imageUrl is a public link with no auth/expiry at all. VIDEO
        // thumbnails always go through the upload flow (frame capture or
        // custom image), never a raw external URL, so they're sent as-is.
        imageUrl: type === "VIDEO" ? imageUrl || undefined : type === "POST" && !fileData ? imageUrl || undefined : undefined,
      };
      if (fileData) {
        body.fileKey = fileData.fileKey;
        body.fileSizeBytes = fileData.fileSizeBytes;
      }

      if (content) {
        await apiRequest(`/content/${content.id}`, { method: "PATCH", body });
      } else {
        // Reuse the contentId reserved by /api/upload (if a file was
        // uploaded) so the Storage path and DB row id line up.
        if (fileData) body.id = fileData.contentId;
        await apiRequest("/content", { method: "POST", body });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save this content.");
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  }

  return (
    <Modal title={content ? "Edit content" : "New content"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Type" htmlFor="ct-type">
          <select
            id="ct-type"
            value={type}
            disabled={!!content}
            onChange={(e) => setType(e.target.value as ContentType)}
            className={inputClass}
          >
            <option value="VIDEO">Video</option>
            <option value="PDF">PDF</option>
            <option value="POST">Post (image)</option>
          </select>
        </Field>

        <Field label="Course" htmlFor="ct-course">
          <select id="ct-course" required value={courseId} onChange={(e) => setCourseId(e.target.value)} className={inputClass}>
            <option value="" disabled>
              Select a course
            </option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Title" htmlFor="ct-title">
          <input id="ct-title" required value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>

        <Field label="Description / caption" htmlFor="ct-desc">
          <textarea id="ct-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
        </Field>

        {(type === "VIDEO" || type === "PDF" || type === "POST") && (
          <Field label={type === "VIDEO" ? "Video file" : type === "PDF" ? "PDF file" : "Image file"} htmlFor="ct-file">
            <input
              id="ct-file"
              type="file"
              accept={type === "VIDEO" ? "video/*" : type === "PDF" ? "application/pdf" : "image/jpeg,image/png,image/webp"}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-700 file:mr-3 file:rounded-full file:border-0 file:bg-ink-100 file:px-3 file:py-2 file:text-sm file:font-medium"
            />
            {content?.hasFile && !file && <p className="mt-1 text-xs text-ink-500">A file is already attached. Choose a new one to replace it.</p>}
            {type === "POST" && (
              <p className="mt-1 text-xs text-ink-500">
                Uploading an image here keeps it private and access-controlled, same as videos/PDFs. Prefer this over a public URL below.
              </p>
            )}
          </Field>
        )}

        {type === "VIDEO" && (
          <Field label="Thumbnail" htmlFor="ct-thumb-picker">
            <div id="ct-thumb-picker">
              <VideoThumbnailPicker videoSrc={videoSrc} imageUrl={imageUrl} onImageUrlChange={setImageUrl} />
            </div>
          </Field>
        )}

        {type === "POST" && !file && !content?.hasFile && (
          <Field label="Image URL (fallback — not access-controlled)" htmlFor="ct-img">
            <input
              id="ct-img"
              type="url"
              placeholder="https://…"
              pattern="https://.*"
              title="Must be an https:// URL"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-amber-600">
              Anyone with this link can view the image directly, even without an account or an active plan. Use the file upload above instead if this needs to stay private.
            </p>
          </Field>
        )}

        {uploadProgress && <p className="mb-3 text-sm text-ink-500">{uploadProgress}</p>}
        {error && <p className="mb-4 text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 text-sm font-medium text-ink-700">
            Cancel
          </button>
          <PrimaryButton disabled={saving}>{saving ? "Saving…" : "Save as draft"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
