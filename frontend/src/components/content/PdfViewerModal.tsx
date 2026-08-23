import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useProtectedFile } from "../../hooks/useProtectedFile";
import { apiRequest } from "../../lib/apiClient";
import type { ContentItem } from "../../types";
import { ErrorState } from "../common/States";
import { Skeleton } from "../common/Skeleton";
import { XIcon, ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon } from "../common/Icons";

// Vite bundles the worker as its own asset; this keeps rendering off the
// main thread without depending on an external CDN.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

export default function PdfViewerModal({ content, onClose }: { content: ContentItem; onClose: () => void }) {
  const { url, error: fileError, loading: fileLoading } = useProtectedFile(content.id);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const viewedRef = useRef(false);

  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [docLoading, setDocLoading] = useState(true);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setPage((p) => Math.min(pageCount || p, p + 1));
      else if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pageCount]);

  // Load the document once the protected URL is available.
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setDocLoading(true);
    setRenderError(null);

    pdfjsLib
      .getDocument({ url })
      .promise.then((doc) => {
        if (cancelled) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setPage(1);
        setDocLoading(false);

        // Read status is a simple "opened" flag — an embedded viewer can't
        // reliably tell us how much the student actually read, so we mark
        // it viewed once the document is available rather than fake a
        // page-based percentage.
        if (!viewedRef.current) {
          viewedRef.current = true;
          apiRequest(`/content/${content.id}/progress`, { method: "POST", body: { viewed: true, progressPercent: 100 } }).catch(() => {});
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRenderError(err instanceof Error ? err.message : "Couldn't load this PDF.");
          setDocLoading(false);
        }
      });

    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url, content.id]);

  // Render the current page whenever page/zoom changes.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || docLoading) return;

    let cancelled = false;
    renderTaskRef.current?.cancel();

    doc.getPage(page).then((pdfPage) => {
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom * (window.devicePixelRatio || 1) });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const task = pdfPage.render({ canvasContext: ctx, viewport });
      renderTaskRef.current = task;
      task.promise.catch(() => {
        // Render cancellations (from rapid page/zoom changes) throw and are expected.
      });
    });

    return () => {
      cancelled = true;
    };
  }, [page, zoom, docLoading]);

  const loading = fileLoading || docLoading;
  const error = fileError || renderError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4" role="dialog" aria-modal="true">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl2 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-ink-900/8 px-4 py-3">
          <p className="truncate text-sm font-medium text-ink-900">{content.title}</p>
          <button onClick={onClose} aria-label="Close PDF" className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex-1 overflow-auto bg-ink-100" onContextMenu={(e) => e.preventDefault()}>
          {loading && <Skeleton className="h-full w-full rounded-none" />}
          {error && <div className="p-6"><ErrorState message={error} /></div>}
          {url && !error && (
            <div className="flex min-h-full items-start justify-center p-4">
              <canvas ref={canvasRef} draggable={false} onContextMenu={(e) => e.preventDefault()} className="select-none rounded shadow-md" />
            </div>
          )}
        </div>

        {!loading && !error && pageCount > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-ink-900/8 bg-white px-4 py-2.5">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
                className="rounded-full p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <span className="min-w-[64px] text-center font-mono text-xs text-ink-700">
                {page} / {pageCount}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
                aria-label="Next page"
                className="rounded-full p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
                disabled={zoom <= MIN_ZOOM}
                aria-label="Zoom out"
                className="rounded-full p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              >
                <ZoomOutIcon className="h-4 w-4" />
              </button>
              <span className="min-w-[42px] text-center font-mono text-xs text-ink-700">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
                disabled={zoom >= MAX_ZOOM}
                aria-label="Zoom in"
                className="rounded-full p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              >
                <ZoomInIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
