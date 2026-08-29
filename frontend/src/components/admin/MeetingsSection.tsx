import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../../lib/apiClient";
import { istInputValueToIso, nowAsIstInputValue, formatIst } from "../../lib/istTime";
import type { ContentItem, Course, Meeting } from "../../types";
import { TableSkeleton } from "../common/Skeleton";
import { ErrorState, EmptyState } from "../common/States";
import VideoPlayerModal from "../content/VideoPlayerModal";

/**
 * The recording badge/buttons below surface the recording_status the
 * backend maintains on each meeting (see meetingRecordingService.js):
 * NONE (no recording configured/attempted), RECORDING (live capture in
 * progress), PROCESSING (meeting ended, LiveKit Egress finalizing the
 * upload), READY (a DRAFT content row exists and can be previewed or
 * published), FAILED.
 */
const RECORDING_LABEL: Record<Meeting["recordingStatus"], string> = {
  NONE: "",
  RECORDING: "Recording…",
  PROCESSING: "Processing recording…",
  READY: "Recording ready",
  FAILED: "Recording failed",
};
const RECORDING_BADGE_CLASS: Record<Meeting["recordingStatus"], string> = {
  NONE: "",
  RECORDING: "bg-red-100 text-red-700",
  PROCESSING: "bg-amber-100 text-amber-700",
  READY: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};

function previewContentFor(meeting: Meeting): ContentItem | null {
  if (!meeting.recordingContentId) return null;
  return {
    id: meeting.recordingContentId,
    title: meeting.title,
    description: meeting.description,
    type: "VIDEO",
    status: "DRAFT",
    courseId: meeting.courseId,
    course: meeting.course ?? undefined,
    durationSeconds: meeting.recordingDurationSeconds ?? null,
    createdAt: meeting.createdAt,
  };
}

export default function MeetingsSection() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [previewMeeting, setPreviewMeeting] = useState<Meeting | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const navigate = useNavigate();

  async function load() {
    setError(null);
    try {
      const [meetingRes, courseRes] = await Promise.all([
        apiRequest<{ meetings: Meeting[] }>("/meetings/admin"),
        apiRequest<{ courses: (Course & { _count?: { content: number } })[] }>("/courses/admin"),
      ]);
      setMeetings(meetingRes.meetings);
      setCourses(courseRes.courses);
      if (!courseId && courseRes.courses[0]) setCourseId(courseRes.courses[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load meetings.");
    }
  }

  useEffect(() => { load(); }, []);

  async function createMeeting(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiRequest("/meetings", { method: "POST", body: { courseId, title, description, scheduledAt: istInputValueToIso(scheduledAt) } });
      setTitle(""); setDescription(""); setScheduledAt("");
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't create meeting.");
    } finally { setBusy(false); }
  }

  async function startMeeting(id: string) {
    // Guard against double-clicks / duplicate submits: without this, two
    // POST /start requests can fire before the first one's response (and
    // the resulting navigate() away from this list) lands. The server's
    // race-condition guard correctly lets only one succeed, but the
    // loser's own catch used to alert() *after* we'd already navigated
    // to /meeting/:id for the winner — surfacing a confusing "Meeting is
    // not in a startable state" popup on top of the meeting room you'd
    // just successfully joined.
    if (startingId) return;
    setStartingId(id);
    try {
      await apiRequest(`/meetings/${id}/start`, { method: "POST" });
      navigate(`/meeting/${id}`);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't start meeting.");
    } finally {
      setStartingId(null);
    }
  }

  async function endMeeting(id: string) {
    try { await apiRequest(`/meetings/${id}/end`, { method: "POST" }); await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : "Couldn't end meeting."); }
  }

  async function deleteMeeting(id: string) {
    if (!confirm("Delete this scheduled meeting?")) return;
    try { await apiRequest(`/meetings/${id}`, { method: "DELETE" }); await load(); }
    catch (err) { alert(err instanceof ApiError ? err.message : "Couldn't delete meeting."); }
  }

  async function publishRecording(id: string) {
    setPublishingId(id);
    try {
      await apiRequest(`/meetings/${id}/recording/publish`, { method: "POST" });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Couldn't publish the recording.");
    } finally {
      setPublishingId(null);
    }
  }

  function recordingBadge(m: Meeting) {
    if (m.recordingStatus === "NONE") return null;
    return (
      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${RECORDING_BADGE_CLASS[m.recordingStatus]}`}>
        {RECORDING_LABEL[m.recordingStatus]}
      </span>
    );
  }

  function recordingActions(m: Meeting) {
    if (m.recordingStatus !== "READY") return null;
    return (
      <>
        <button onClick={() => setPreviewMeeting(m)} className="text-sm font-semibold text-ink-700">Preview</button>
        <button
          onClick={() => publishRecording(m.id)}
          disabled={publishingId === m.id}
          className="text-sm font-semibold text-emerald-700 disabled:opacity-50"
        >
          {publishingId === m.id ? "Publishing…" : "Publish"}
        </button>
      </>
    );
  }

  return (
    <div>
      <div className="mb-5">
        <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-amber-600">Live classes</p>
        <h1 className="mt-1 font-display text-xl font-semibold text-ink-950">Meetings</h1>
      </div>

      <form onSubmit={createMeeting} className="mb-6 grid gap-3 rounded-xl2 border border-ink-900/8 bg-white p-5 shadow-card sm:grid-cols-2">
        <div className="sm:col-span-2"><h2 className="font-semibold text-ink-950">Schedule a live class</h2></div>
        <label className="text-sm text-ink-700">Course<select value={courseId} onChange={(e) => setCourseId(e.target.value)} required className="mt-1 w-full rounded-lg border border-ink-900/15 bg-white px-3 py-2">{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label className="text-sm text-ink-700">Title<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} className="mt-1 w-full rounded-lg border border-ink-900/15 px-3 py-2" placeholder="Live class" /></label>
        <label className="text-sm text-ink-700">Date &amp; time (IST)<input type="datetime-local" value={scheduledAt} min={nowAsIstInputValue()} onChange={(e) => setScheduledAt(e.target.value)} required className="mt-1 w-full rounded-lg border border-ink-900/15 px-3 py-2" /></label>
        <label className="text-sm text-ink-700">Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} className="mt-1 w-full rounded-lg border border-ink-900/15 px-3 py-2" placeholder="Optional" /></label>
        <div className="sm:col-span-2"><button disabled={busy || !courseId} className="rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Creating…" : "Schedule meeting"}</button></div>
      </form>

      {meetings === null && !error && <TableSkeleton columns={5} rows={5} />}
      {error && <ErrorState message={error} onRetry={load} />}
      {meetings && meetings.length === 0 && <EmptyState title="No meetings yet" description="Schedule your first live class above." />}
      {meetings && meetings.length > 0 && (
        <>
          {/* Mobile: stacked cards */}
          <div className="space-y-3 sm:hidden">
            {meetings.map((m) => (
              <div key={m.id} className="rounded-xl2 border border-ink-900/8 bg-white p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-ink-900">{m.title}</p>
                  <span className="shrink-0 rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-600">{m.status}</span>
                </div>
                <p className="mt-1 text-sm text-ink-500">{m.course?.title || "—"}</p>
                <p className="mt-1 text-xs font-medium text-ink-600">{formatIst(m.scheduledAt)} IST</p>
                {m.recordingStatus !== "NONE" && <p className="mt-1">{recordingBadge(m)}</p>}
                <div className="mt-3 flex flex-wrap gap-4 border-t border-ink-900/8 pt-3">
                  {m.status === "SCHEDULED" && <button onClick={() => startMeeting(m.id)} disabled={startingId === m.id} className="text-sm font-semibold text-emerald-700 disabled:opacity-50">{startingId === m.id ? "Starting…" : "Start"}</button>}
                  {m.status === "LIVE" && (
                    <>
                      <button onClick={() => navigate(`/meeting/${m.id}`)} className="text-sm font-semibold text-amber-700">Join</button>
                      <button onClick={() => endMeeting(m.id)} className="text-sm font-semibold text-red-600">End</button>
                    </>
                  )}
                  {recordingActions(m)}
                  {m.status === "SCHEDULED" && <button onClick={() => deleteMeeting(m.id)} className="text-sm font-semibold text-red-600">Delete</button>}
                </div>
              </div>
            ))}
          </div>

          {/* Tablet/desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl2 border border-ink-900/8 bg-white shadow-card sm:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-ink-900/8 text-xs uppercase tracking-wide text-ink-500"><tr><th className="px-5 py-3">Meeting</th><th className="px-5 py-3">Course</th><th className="px-5 py-3">Time</th><th className="px-5 py-3">Status</th><th className="px-5 py-3" /></tr></thead>
              <tbody className="divide-y divide-ink-900/8">
                {meetings.map((m) => <tr key={m.id}>
                  <td className="px-5 py-3 font-medium text-ink-900">{m.title}</td>
                  <td className="px-5 py-3 text-ink-500">{m.course?.title || "—"}</td>
                  <td className="px-5 py-3 text-ink-500">{formatIst(m.scheduledAt)} IST</td>
                  <td className="px-5 py-3"><span className="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600">{m.status}</span>{recordingBadge(m)}</td>
                  <td className="px-5 py-3"><div className="flex flex-wrap justify-end gap-3">
                    {m.status === "SCHEDULED" && <button onClick={() => startMeeting(m.id)} disabled={startingId === m.id} className="text-sm font-semibold text-emerald-700 disabled:opacity-50">{startingId === m.id ? "Starting…" : "Start"}</button>}
                    {m.status === "LIVE" && <><button onClick={() => navigate(`/meeting/${m.id}`)} className="text-sm font-semibold text-amber-700">Join</button><button onClick={() => endMeeting(m.id)} className="text-sm font-semibold text-red-600">End</button></>}
                    {recordingActions(m)}
                    {m.status === "SCHEDULED" && <button onClick={() => deleteMeeting(m.id)} className="text-sm font-semibold text-red-600">Delete</button>}
                  </div></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
      {previewMeeting && (
        <VideoPlayerModal
          content={previewContentFor(previewMeeting)!}
          onClose={() => setPreviewMeeting(null)}
        />
      )}
    </div>
  );
}
