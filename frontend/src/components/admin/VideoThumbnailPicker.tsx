import { useEffect, useRef, useState } from "react";
import { apiRequest, ApiError } from "../../lib/apiClient";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_MB = 10;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Instagram-style thumbnail picker for VIDEO content: scrub the video to
 * any frame and grab it as the thumbnail, or upload a custom image
 * instead. Either path uploads the resulting image through the existing
 * POST /courses/thumbnail endpoint (a generic, admin-only image upload
 * that isn't actually tied to a course — it just returns a permanent
 * public URL), so the result can be saved as this content's `imageUrl`.
 *
 * `videoSrc` can be a local blob: URL (a freshly picked file, not yet
 * uploaded) or a same-origin /api/files/stream/:id URL (an existing
 * video, via useProtectedFile) — both are safe to draw into a canvas
 * without tainting it.
 */
export default function VideoThumbnailPicker({
  videoSrc,
  imageUrl,
  onImageUrlChange,
}: {
  videoSrc: string | null;
  imageUrl: string;
  onImageUrlChange: (url: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [duration, setDuration] = useState(0);
  const [scrub, setScrub] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset scrub state whenever the underlying video changes.
  useEffect(() => {
    setDuration(0);
    setScrub(0);
    setReady(false);
    setError(null);
  }, [videoSrc]);

  function handleLoadedMetadata() {
    const v = videoRef.current;
    if (!v) return;
    const total = Number.isFinite(v.duration) ? v.duration : 0;
    setDuration(total);
    // Start a little into the clip rather than on a likely-black first frame.
    const initial = total > 0 ? Math.min(1, total / 2) : 0;
    v.currentTime = initial;
    setScrub(initial);
    setReady(true);
  }

  function handleScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const t = Number(e.target.value);
    setScrub(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  }

  async function uploadImage(fileOrBlob: File | Blob, filename = "thumbnail.jpg", type = "image/jpeg") {
    setError(null);
    setBusy(true);
    try {
      const formData = new FormData();
      const file = fileOrBlob instanceof File ? fileOrBlob : new File([fileOrBlob], filename, { type });
      formData.append("file", file);
      const res = await apiRequest<{ thumbnailUrl: string }>("/courses/thumbnail", {
        method: "POST",
        body: formData,
        isFormData: true,
      });
      onImageUrlChange(res.thumbnailUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save that image. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 360;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError("Your browser doesn't support capturing this frame.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) {
      setError("Couldn't capture that frame. Please try again.");
      return;
    }
    await uploadImage(blob);
  }

  function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Please choose a JPG, PNG, or WEBP image.");
      return;
    }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      setError(`Image is too large — please choose one under ${MAX_IMAGE_MB}MB.`);
      return;
    }
    uploadImage(file);
  }

  return (
    <div className="rounded-xl2 border border-ink-900/10 bg-paper-100/60 p-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="w-full max-w-[220px] shrink-0">
          {videoSrc ? (
            <>
              <div className="relative overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={handleLoadedMetadata}
                  className="aspect-video w-full object-contain"
                />
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.1)}
                step={0.1}
                value={scrub}
                disabled={!ready}
                onChange={handleScrub}
                className="mt-2 w-full accent-ink-950 disabled:opacity-40"
                aria-label="Scrub to pick a thumbnail frame"
              />
              <div className="flex items-center justify-between text-[11px] text-ink-500">
                <span>{formatTime(scrub)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <button
                type="button"
                onClick={captureFrame}
                disabled={busy || !ready}
                className="mt-1.5 w-full rounded-full bg-ink-950 px-3 py-1.5 text-xs font-semibold text-paper-50 transition hover:bg-ink-900 disabled:opacity-50"
              >
                {busy ? "Saving frame…" : "Use this frame"}
              </button>
            </>
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-ink-900/20 px-3 text-center text-xs text-ink-500">
              Choose a video file to pick a frame from it
            </div>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        <div className="min-w-[140px] flex-1">
          <p className="text-xs font-medium text-ink-700">Thumbnail</p>
          <div className="mt-1.5 flex items-center gap-3">
            {imageUrl ? (
              <img src={imageUrl} alt="Thumbnail preview" className="h-16 w-24 shrink-0 rounded-lg border border-ink-900/15 object-cover" />
            ) : (
              <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-dashed border-ink-900/20 text-[10px] text-ink-400">
                None yet
              </div>
            )}
            <div>
              <label className="inline-block cursor-pointer rounded-full border border-ink-900/15 px-3 py-1.5 text-xs font-semibold text-ink-900 hover:border-ink-900/30">
                Upload image
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleUploadChange} className="hidden" />
              </label>
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => onImageUrlChange("")}
                  className="ml-2 text-xs font-medium text-ink-500 hover:text-ink-950"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">Scrub the preview and tap "Use this frame", or upload your own image. Shown to students instead of a generic icon.</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
