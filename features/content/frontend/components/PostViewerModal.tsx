import { useCallback, useEffect, useRef, useState } from "react";
import { useProtectedFile } from "../hooks/useProtectedFile";
import { apiRequest } from "../../../../shared/frontend-core/lib/apiClient";
import type { ContentItem } from "../../../../shared/frontend-core/types/index";
import { Skeleton } from "../../../../shared/frontend-core/components/common/Skeleton";
import { XIcon, ChevronLeftIcon, ChevronRightIcon, ZoomInIcon, ZoomOutIcon } from "../../../../shared/frontend-core/components/common/Icons";

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function distance(a: React.Touch, b: React.Touch) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** One image, pinch-to-zoom / double-tap-zoom / drag-to-pan, Instagram-post style. */
function ZoomableImage({ src, alt, onSwipe }: { src: string; alt: string; onSwipe: (dir: 1 | -1) => void }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pinchStartDist = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const dragStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const lastTapRef = useRef(0);

  // Reset zoom whenever the image changes.
  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
  }, [src]);

  function clampPan(nextScale: number, nx: number, ny: number) {
    const wrap = wrapRef.current;
    if (!wrap) return { x: nx, y: ny };
    const maxX = (wrap.clientWidth * (nextScale - 1)) / 2;
    const maxY = (wrap.clientHeight * (nextScale - 1)) / 2;
    return { x: Math.min(maxX, Math.max(-maxX, nx)), y: Math.min(maxY, Math.max(-maxY, ny)) };
  }

  function zoomTo(nextScale: number) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
    setScale(clamped);
    if (clamped === 1) {
      setTx(0);
      setTy(0);
    } else {
      const { x, y } = clampPan(clamped, tx, ty);
      setTx(x);
      setTy(y);
    }
  }

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomTo(scale - e.deltaY * 0.0025);
  }

  function handleDoubleClick() {
    zoomTo(scale > 1 ? 1 : 2.5);
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchStartDist.current = distance(e.touches[0], e.touches[1]);
      pinchStartScale.current = scale;
    } else if (e.touches.length === 1) {
      if (scale > 1) {
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty };
      } else {
        swipeStartX.current = e.touches[0].clientX;
      }
      const now = Date.now();
      if (now - lastTapRef.current < 280) handleDoubleClick();
      lastTapRef.current = now;
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchStartDist.current) {
      e.preventDefault();
      const d = distance(e.touches[0], e.touches[1]);
      zoomTo(pinchStartScale.current * (d / pinchStartDist.current));
    } else if (e.touches.length === 1 && dragStart.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      const { x, y } = clampPan(scale, dragStart.current.tx + dx, dragStart.current.ty + dy);
      setTx(x);
      setTy(y);
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (e.touches.length === 0) {
      pinchStartDist.current = null;
      dragStart.current = null;
      if (swipeStartX.current !== null && scale === 1) {
        const endX = e.changedTouches[0]?.clientX ?? swipeStartX.current;
        const delta = endX - swipeStartX.current;
        if (Math.abs(delta) > 60) onSwipe(delta < 0 ? 1 : -1);
      }
      swipeStartX.current = null;
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-black touch-none"
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        className="max-h-full max-w-full select-none object-contain transition-transform duration-100 ease-out"
        style={{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}
      />
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-black/50 p-1 backdrop-blur-sm">
        <button
          onClick={() => zoomTo(scale - 0.5)}
          disabled={scale <= MIN_SCALE}
          aria-label="Zoom out"
          className="rounded-full p-1.5 text-paper-50 hover:bg-white/10 disabled:opacity-30"
        >
          <ZoomOutIcon className="h-4 w-4" />
        </button>
        <span className="min-w-[36px] text-center font-mono text-[11px] text-paper-50">{Math.round(scale * 100)}%</span>
        <button
          onClick={() => zoomTo(scale + 0.5)}
          disabled={scale >= MAX_SCALE}
          aria-label="Zoom in"
          className="rounded-full p-1.5 text-paper-50 hover:bg-white/10 disabled:opacity-30"
        >
          <ZoomInIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function PostViewerModal({
  items,
  initialIndex = 0,
  onClose,
}: {
  items: ContentItem[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const markedRef = useRef<Set<string>>(new Set());
  const content = items[index];
  const { url: protectedUrl } = useProtectedFile(content?.hasFile ? content.id : null);
  const imageSrc = content?.hasFile ? protectedUrl : content?.imageUrl;

  const goTo = useCallback(
    (next: number) => setIndex((i) => Math.min(items.length - 1, Math.max(0, next === -1 ? i : next))),
    [items.length]
  );
  const swipe = useCallback(
    (dir: 1 | -1) => setIndex((i) => Math.min(items.length - 1, Math.max(0, i + dir))),
    [items.length]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") swipe(1);
      else if (e.key === "ArrowLeft") swipe(-1);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, swipe]);

  // Mark each post viewed once, the first time it's shown in the carousel.
  useEffect(() => {
    if (!content || markedRef.current.has(content.id)) return;
    markedRef.current.add(content.id);
    apiRequest(`/content/${content.id}/progress`, { method: "POST", body: { viewed: true, progressPercent: 100 } }).catch(() => {});
  }, [content]);

  if (!content) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl2 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-900/8 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900">{content.title}</p>
            {items.length > 1 && (
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-400">
                {index + 1} / {items.length}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close post" className="rounded-full p-1.5 text-ink-500 hover:bg-ink-100">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex-1 bg-black">
          {!imageSrc && <Skeleton className="h-full w-full rounded-none bg-white/10" />}
          {imageSrc && <ZoomableImage key={content.id} src={imageSrc} alt={content.title} onSwipe={swipe} />}

          {items.length > 1 && (
            <>
              <button
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
                aria-label="Previous post"
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-paper-50 backdrop-blur-sm hover:bg-black/60 disabled:opacity-0"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => goTo(index + 1)}
                disabled={index === items.length - 1}
                aria-label="Next post"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-paper-50 backdrop-blur-sm hover:bg-black/60 disabled:opacity-0"
              >
                <ChevronRightIcon className="h-5 w-5" />
              </button>
              <div className="absolute top-2 left-1/2 flex -translate-x-1/2 gap-1">
                {items.map((it, i) => (
                  <span key={it.id} className={`h-1 w-5 rounded-full transition-colors ${i === index ? "bg-amber-400" : "bg-white/30"}`} />
                ))}
              </div>
            </>
          )}
        </div>

        {content.description && <p className="max-h-24 overflow-y-auto p-4 text-sm leading-relaxed text-ink-700">{content.description}</p>}
      </div>
    </div>
  );
}
