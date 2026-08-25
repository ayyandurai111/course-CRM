import { useCallback, useEffect, useRef, useState } from "react";
import { useProtectedFile } from "../../hooks/useProtectedFile";
import { apiRequest, getToken } from "../../lib/apiClient";
import type { ContentItem } from "../../types";
import { ErrorState } from "../common/States";
import { Skeleton } from "../common/Skeleton";
import {
  XIcon,
  PlayIcon,
  PauseIcon,
  Volume2Icon,
  VolumeXIcon,
  MaximizeIcon,
  MinimizeIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SettingsIcon,
} from "../common/Icons";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function VideoPlayerModal({ content, onClose }: { content: ContentItem; onClose: () => void }) {
  const { url, error, loading, refresh } = useProtectedFile(content.id);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const lastSaveRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const recoveringRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const [ended, setEnded] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [resumedFromSeconds, setResumedFromSeconds] = useState<number | null>(null);
  const appliedResumeRef = useRef(false);
  const hasAutoStartedRef = useRef(false);

  // ---- Progress persistence (unchanged behavior from before) ----
  const saveProgress = useCallback(
    async (percent: number, positionSeconds: number, force = false) => {
      const now = Date.now();
      if (!force && now - lastSaveRef.current < 4000 && percent < 100) return;
      lastSaveRef.current = now;
      try {
        await apiRequest(`/content/${content.id}/progress`, {
          method: "POST",
          body: { progressPercent: Math.round(percent), lastPositionSeconds: Math.round(positionSeconds), viewed: percent >= 95 },
        });
      } catch {
        // Non-critical — progress will sync on the next tick or view.
      }
    },
    [content.id]
  );

  // Flush the most recent playback position immediately, bypassing the
  // periodic throttle. Without this, closing the player shortly after the
  // last auto-save (up to ~4s of watch time) silently drops that progress,
  // so reopening the video resumes from the stale saved position instead
  // of where the student actually left off.
  const flushProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return Promise.resolve();
    return saveProgress((v.currentTime / v.duration) * 100, v.currentTime, true);
  }, [saveProgress]);

  const handleClose = useCallback(async () => {
    // Wait for the save to actually land before closing. Firing it and
    // closing immediately raced against the parent's post-close list
    // refresh (GET /content) — if that GET resolved before this POST had
    // written the new position, the refreshed list still carried the old
    // value, and reopening the video resumed from the stale position.
    await flushProgress();
    onClose();
  }, [flushProgress, onClose]);

  // Safety net: also flush on unmount (covers any close path that doesn't
  // go through handleClose) and when the tab is hidden/backgrounded.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) flushProgress();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      flushProgress();
    };
  }, [flushProgress]);

  // ---- Browser/tab close ----
  // When the whole page is being torn down (tab closed, browser quit,
  // hard navigation), a normal `await apiRequest(...)` can get killed
  // mid-flight before the request is even sent — the JS engine doesn't
  // wait around for it. `fetch(..., { keepalive: true })` is built for
  // exactly this case: the browser keeps the request alive independently
  // of the page that started it. apiRequest also fetches a fresh auth
  // token asynchronously on every call, which won't resolve in time
  // during unload, so the token is cached ahead of time instead.
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    getToken().then((t) => { tokenRef.current = t; }).catch(() => {});
  }, []);

  const keepaliveFlush = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const percent = (v.currentTime / v.duration) * 100;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (tokenRef.current) headers.Authorization = `Bearer ${tokenRef.current}`;
    try {
      fetch(`/api/content/${content.id}/progress`, {
        method: "POST",
        headers,
        keepalive: true,
        body: JSON.stringify({
          progressPercent: Math.round(percent),
          lastPositionSeconds: Math.round(v.currentTime),
          viewed: percent >= 95,
        }),
      }).catch(() => {});
    } catch {
      // keepalive requests are best-effort — nothing to recover from here.
    }
  }, [content.id]);

  useEffect(() => {
    document.addEventListener("pagehide", keepaliveFlush);
    window.addEventListener("beforeunload", keepaliveFlush);
    return () => {
      document.removeEventListener("pagehide", keepaliveFlush);
      window.removeEventListener("beforeunload", keepaliveFlush);
    };
  }, [keepaliveFlush]);

  // ---- Auto-hide controls ----
  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2800);
  }, []);

  const wake = useCallback(() => {
    setControlsVisible(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  // ---- Stuck/black-frame recovery ----
  // The stream is proxied through our own backend (browser -> our API ->
  // Supabase signed URL), which adds a hop that can transiently fail or
  // hang without the <video> element ever surfacing a visible error —
  // the symptom is a fully black player that never starts, previously
  // only fixable by refreshing the whole page. A refresh "works" only
  // because it mints a brand-new playback token and gives the video
  // element a clean load; we can do the same thing in place instead.
  const MAX_AUTO_RETRIES = 2;
  const STALL_TIMEOUT_MS = 8000;

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
  }, []);

  const recover = useCallback(
    async (auto: boolean) => {
      const v = videoRef.current;
      if (!v || recoveringRef.current) return;
      if (auto) {
        if (retryCountRef.current >= MAX_AUTO_RETRIES) {
          setStuck(true);
          return;
        }
        retryCountRef.current += 1;
      } else {
        retryCountRef.current = 0;
      }
      recoveringRef.current = true;
      setStuck(false);
      try {
        const resumeAt = v.currentTime;
        await refresh(); // mints a fresh playback cookie for the same URL
        // The src string never changes on refresh, so React won't reload
        // it for us — force the element to re-request the resource now
        // that a valid cookie exists.
        v.load();
        if (resumeAt > 0) {
          const onLoaded = () => {
            v.currentTime = resumeAt;
            v.removeEventListener("loadedmetadata", onLoaded);
          };
          v.addEventListener("loadedmetadata", onLoaded);
        }
        if (playing) await v.play().catch(() => {});
      } finally {
        recoveringRef.current = false;
      }
    },
    [refresh, playing]
  );

  function armStallWatchdog() {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      // Still not producing frames after a reasonable wait — treat this
      // like a stuck/black player and try to recover automatically.
      recover(true);
    }, STALL_TIMEOUT_MS);
  }

  function handleVideoError() {
    recover(true);
  }

  function handleWaiting() {
    armStallWatchdog();
  }

  function handlePlaying() {
    clearStallTimer();
    retryCountRef.current = 0;
    setStuck(false);
  }

  useEffect(() => clearStallTimer, [clearStallTimer]);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else handleClose();
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowRight":
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
          wake();
          break;
        case "ArrowLeft":
          v.currentTime = Math.max(0, v.currentTime - 10);
          wake();
          break;
        case "ArrowUp":
          e.preventDefault();
          setVolumeSafe(Math.min(1, (v.muted ? 0 : v.volume) + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setVolumeSafe(Math.max(0, (v.muted ? 0 : v.volume) - 0.1));
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleClose]);

  useEffect(() => {
    function onFsChange() { setFullscreen(!!document.fullscreenElement); }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function setVolumeSafe(v: number) {
    const el = videoRef.current;
    if (!el) return;
    el.volume = v;
    el.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
    wake();
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    wake();
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    wake();
  }

  function toggleFullscreen() {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
    wake();
  }

  function skip(delta: number) {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + delta));
    wake();
  }

  function changeSpeed(s: number) {
    const v = videoRef.current;
    if (v) v.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
    wake();
  }

  function seekToClientX(clientX: number) {
    const bar = seekBarRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    v.currentTime = ratio * v.duration;
    setCurrentTime(v.currentTime);
  }

  function handleSeekPointerDown(e: React.PointerEvent) {
    setScrubbing(true);
    seekToClientX(e.clientX);
    wake();
    const onMove = (ev: PointerEvent) => seekToClientX(ev.clientX);
    const onUp = () => {
      setScrubbing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    clearStallTimer();
    if (!scrubbing) setCurrentTime(v.currentTime);
    if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    if (!v.duration) return;
    saveProgress((v.currentTime / v.duration) * 100, v.currentTime);
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl overflow-hidden rounded-xl2 bg-black shadow-2xl">
        <div className="flex items-center justify-between bg-ink-950 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-paper-50">{content.title}</p>
            {resumedFromSeconds !== null && (
              <p className="text-[11px] text-paper-50/60">Resumed from {formatTime(resumedFromSeconds)}</p>
            )}
          </div>
          <button onClick={handleClose} aria-label="Close video" className="rounded-full p-1.5 text-paper-50 hover:bg-white/10">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="group relative aspect-video w-full select-none bg-black"
          onMouseMove={wake}
          onPointerLeave={() => { if (playing) setControlsVisible(false); }}
        >
          {loading && <Skeleton className="h-full w-full rounded-none bg-white/10" />}
          {error && <div className="p-6"><ErrorState message={error} /></div>}

          {url && (
            <>
              <video
                ref={videoRef}
                src={url}
                playsInline
                preload="metadata"
                disablePictureInPicture
                disableRemotePlayback
                controlsList="nodownload noremoteplayback"
                onContextMenu={(e) => e.preventDefault()}
                className="h-full w-full cursor-pointer"
                onClick={togglePlay}
                onDoubleClick={toggleFullscreen}
                onLoadedMetadata={() => {
                  const v = videoRef.current;
                  if (!v) return;
                  setDuration(v.duration || 0);
                  // Resume where the student left off last time they watched
                  // this video (only once per mount — later loadedmetadata
                  // firings, e.g. from stall recovery, must not jump back).
                  //
                  // Two things matter here, in order:
                  // 1. `lastPositionSeconds` comes from a Postgres `numeric`
                  //    column, which Supabase/PostgREST can serialize as a
                  //    JSON string (e.g. "125" instead of 125) — Number(...)
                  //    it explicitly rather than trusting the type.
                  // 2. The seek MUST land before playback starts. Previously
                  //    the <video> had a plain `autoPlay` attribute, so the
                  //    browser could start decoding/rendering frame 0 before
                  //    this handler ran, racing our currentTime assignment.
                  //    Now we drive play() ourselves, after the seek, so
                  //    there's no window where frame 0 can render first.
                  if (!appliedResumeRef.current) {
                    appliedResumeRef.current = true;
                    const savedPositionRaw = content.progress?.lastPositionSeconds;
                    const savedPosition = savedPositionRaw != null ? Number(savedPositionRaw) : null;
                    if (
                      savedPosition != null &&
                      Number.isFinite(savedPosition) &&
                      savedPosition > 5 &&
                      v.duration &&
                      savedPosition < v.duration - 5
                    ) {
                      v.currentTime = savedPosition;
                      setCurrentTime(savedPosition);
                      setResumedFromSeconds(savedPosition);
                    }
                  }
                  // Auto-start playback ourselves, exactly once, after the
                  // seek above has landed. Stall recovery also reloads the
                  // video (v.load()) and fires this same event again with
                  // its own conditional play() call gated on whether the
                  // video was actually playing before the stall — that one
                  // must win on subsequent loads, so this only fires once.
                  if (!hasAutoStartedRef.current) {
                    hasAutoStartedRef.current = true;
                    v.play().catch(() => {});
                  }
                }}
                onDurationChange={() => setDuration(videoRef.current?.duration || 0)}
                onPlay={() => { setPlaying(true); setEnded(false); wake(); armStallWatchdog(); }}
                onPlaying={handlePlaying}
                onPause={() => { setPlaying(false); setControlsVisible(true); }}
                onWaiting={handleWaiting}
                onError={handleVideoError}
                onVolumeChange={() => { const v = videoRef.current; if (v) { setVolume(v.volume); setMuted(v.muted); } }}
                onTimeUpdate={handleTimeUpdate}
                onEnded={() => { setEnded(true); setControlsVisible(true); saveProgress(100, videoRef.current?.duration || 0); }}
              />

              {stuck && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
                  <p className="text-sm text-paper-50">This video is having trouble loading.</p>
                  <button
                    onClick={() => recover(false)}
                    className="rounded-full bg-amber-400 px-4 py-1.5 text-xs font-semibold text-ink-950 hover:bg-amber-300"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Center play/pause tap target + big icon when paused/ended */}
              {!stuck && (!playing || ended) && (
                <button
                  onClick={togglePlay}
                  aria-label={playing ? "Pause" : "Play"}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-paper-50 backdrop-blur-sm transition group-hover:scale-105">
                    <PlayIcon className="h-7 w-7 translate-x-0.5" />
                  </span>
                </button>
              )}

              {/* Controls bar */}
              <div
                className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${controlsVisible ? "opacity-100" : "opacity-0"}`}
              >
                {/* Seek bar */}
                <div
                  ref={seekBarRef}
                  onPointerDown={handleSeekPointerDown}
                  className="group/seek relative mb-2 h-3 w-full cursor-pointer touch-none"
                >
                  <div className="absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-white/25" />
                  <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
                  <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-amber-400" style={{ width: `${progressPct}%` }} />
                  <div
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400 shadow transition-transform group-hover/seek:scale-125"
                    style={{ left: `${progressPct}%` }}
                  />
                </div>

                <div className="flex items-center gap-2 text-paper-50">
                  <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="rounded-full p-1.5 hover:bg-white/10">
                    {playing ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                  </button>
                  <button onClick={() => skip(-10)} aria-label="Back 10 seconds" className="rounded-full p-1.5 hover:bg-white/10">
                    <RotateCcwIcon className="h-4 w-4" />
                  </button>
                  <button onClick={() => skip(10)} aria-label="Forward 10 seconds" className="rounded-full p-1.5 hover:bg-white/10">
                    <RotateCwIcon className="h-4 w-4" />
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="rounded-full p-1.5 hover:bg-white/10">
                      {muted || volume === 0 ? <VolumeXIcon className="h-4 w-4" /> : <Volume2Icon className="h-4 w-4" />}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      onChange={(e) => setVolumeSafe(Number(e.target.value))}
                      aria-label="Volume"
                      className="h-1 w-16 accent-amber-400"
                    />
                  </div>

                  <span className="ml-1 whitespace-nowrap font-mono text-xs text-paper-50/90">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>

                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="relative">
                      <button
                        onClick={() => setShowSpeedMenu((s) => !s)}
                        aria-label="Playback speed"
                        className="flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-medium hover:bg-white/10"
                      >
                        <SettingsIcon className="h-3.5 w-3.5" />
                        {speed}x
                      </button>
                      {showSpeedMenu && (
                        <div className="absolute bottom-full right-0 mb-2 w-20 overflow-hidden rounded-lg bg-ink-950 py-1 shadow-xl">
                          {SPEEDS.map((s) => (
                            <button
                              key={s}
                              onClick={() => changeSpeed(s)}
                              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 ${s === speed ? "text-amber-400" : "text-paper-50"}`}
                            >
                              {s}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} className="rounded-full p-1.5 hover:bg-white/10">
                      {fullscreen ? <MinimizeIcon className="h-4 w-4" /> : <MaximizeIcon className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
