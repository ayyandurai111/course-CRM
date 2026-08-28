const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const { AccessToken, LiveKitAPI } = require("livekit-server-sdk");
const { supabase, row, rows, toSnake, assertNoError } = require("../lib/db");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { userCanAccessCourseForLiveMeeting } = require("../services/accessService");
const { logAction } = require("../services/auditService");
const { startRecording, stopRecording } = require("../services/meetingRecordingService");
const contentService = require("../services/contentService");

const router = express.Router();

function requireLiveKitConfig() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !wsUrl) {
    const err = new Error("Live meeting service is not configured on the server.");
    err.status = 503;
    throw err;
  }
  if (!/^wss?:\/\//i.test(wsUrl)) {
    const err = new Error("LIVEKIT_WS_URL must start with ws:// or wss://.");
    err.status = 500;
    throw err;
  }
  return { apiKey, apiSecret, wsUrl };
}

function liveKitHost(wsUrl) {
  const parsed = new URL(wsUrl);
  return `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
}

function liveKitApi() {
  const { apiKey, apiSecret, wsUrl } = requireLiveKitConfig();
  return new LiveKitAPI({ host: liveKitHost(wsUrl), apiKey, secret: apiSecret });
}

const createSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional().default(""),
  scheduledAt: z.string().datetime({ offset: true }),
});

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("meetings")
      .select("*, courses(id,title)")
      .order("scheduled_at", { ascending: true });
    assertNoError(error, "Failed to load meetings");
    const shaped = rows(data).map((m) => ({ ...m, course: m.courses || null }));
    shaped.forEach((m) => delete m.courses);
    res.json({ meetings: shaped });
  } catch (err) { next(err); }
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { courseId, title, description, scheduledAt } = parsed.data;
    const { data: course, error: courseError } = await supabase.from("courses").select("id,title,is_published").eq("id", courseId).maybeSingle();
    assertNoError(courseError, "Failed to load course");
    if (!course) return res.status(404).json({ error: "Course not found." });
    if (!course.is_published) return res.status(409).json({ error: "Publish the course before scheduling a live meeting." });
    if (new Date(scheduledAt).getTime() <= Date.now()) return res.status(400).json({ error: "Meeting time must be in the future." });

    requireLiveKitConfig();
    const roomName = `course-${courseId}-${crypto.randomUUID()}`;
    const payload = { courseId, title, description, roomName, status: "SCHEDULED", scheduledAt, createdById: req.user.id };
    const { data, error } = await supabase.from("meetings").insert(toSnake(payload)).select("*, courses(id,title)").single();
    assertNoError(error, "Failed to create meeting");
    await logAction({ actorId: req.user.id, action: "meeting.create", entityType: "Meeting", entityId: data.id, metadata: { courseId } });
    const shaped = row(data); shaped.course = shaped.courses || null; delete shaped.courses;
    res.status(201).json({ meeting: shaped });
  } catch (err) { next(err); }
});

router.get("/upcoming", authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("meetings")
      .select("*, courses(id,title)")
      .in("status", ["SCHEDULED", "LIVE"])
      .order("scheduled_at", { ascending: true });
    assertNoError(error, "Failed to load meetings");
    const accessible = [];
    for (const meeting of rows(data)) {
      if (await userCanAccessCourseForLiveMeeting(req.user.id, meeting.courseId)) {
        meeting.course = meeting.courses || null;
        delete meeting.courses;
        accessible.push(meeting);
      }
    }
    res.json({ meetings: accessible });
  } catch (err) { next(err); }
});

// Race condition fix: two admins clicking "Start" at nearly the same
// instant used to both pass a plain SELECT ... WHERE status='SCHEDULED'
// read (no lock), both create the same LiveKit room (idempotent
// no-op for the loser), then both attempt an UPDATE ... WHERE
// status='SCHEDULED'. Only one UPDATE could actually match — but the
// LOSER's code path then treated "0 rows updated" as "I lost, clean up
// the room I made", and called deleteRoom(current.room_name). Since
// both requests share the exact same room_name (it's fixed on the
// meeting row, not per-attempt), the loser was deleting the WINNER's
// just-started, actually-live room — leaving the meeting stuck at
// status=LIVE with no real LiveKit room behind it.
//
// Fixed by making the atomic UPDATE ... WHERE status='SCHEDULED' the
// *first* thing that happens. Only the single request whose UPDATE
// actually matches a row proceeds to talk to LiveKit at all; every
// other concurrent request gets zero rows back immediately and returns
// 409 without ever touching the LiveKit API, so there is no longer any
// window where a loser can delete a winner's room. If LiveKit room
// creation itself fails after the winning UPDATE, the meeting is rolled
// back to SCHEDULED so it isn't left stuck LIVE with no room.
/**
 * Core of POST /:id/start, factored out so the race-condition fix is
 * directly unit-testable without spinning up Express/LiveKit (see
 * meetingStartRaceCondition.test.js). `deps` are injected so tests can
 * fake supabase/liveKitApi and simulate two "concurrent" callers by
 * simply invoking this twice against a shared fake data store.
 */
async function startMeetingCore(meetingId, deps) {
  const db = deps.supabase;
  let { data, error } = await db
    .from("meetings")
    .update({ status: "LIVE", started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", meetingId)
    .eq("status", "SCHEDULED")
    .select("*, courses(id,title)")
    .maybeSingle();
  assertNoError(error, "Failed to start meeting");
  if (!data) return { conflict: true };

  try {
    const api = deps.liveKitApi();
    await api.room.createRoom({ name: data.room_name, emptyTimeout: 10 * 60, maxParticipants: Number(process.env.LIVEKIT_MAX_PARTICIPANTS || 100) });
  } catch (roomErr) {
    // Room creation failed after we already flipped the DB row to
    // LIVE — roll back so the meeting isn't stuck LIVE with no actual
    // room.
    await db.from("meetings").update({ status: "SCHEDULED", started_at: null, updated_at: new Date().toISOString() }).eq("id", meetingId).eq("status", "LIVE");
    throw roomErr;
  }

  // Recording (LiveKit Egress -> Supabase Storage) is best-effort and
  // only attempted by whichever request actually won the race above —
  // it never affects whether the meeting itself successfully starts.
  // deps.startRecording is a no-op returning null when recording isn't
  // configured on this deployment (see recordingConfig.js), and the
  // test fakes for this function never set it, so this whole block is
  // skipped there.
  if (typeof deps.startRecording === "function") {
    try {
      const egressClient = deps.liveKitApi().egress;
      const recordingPatch = await deps.startRecording({
        meeting: { ...data, roomName: data.room_name, courseId: data.course_id },
        egressClient,
      });
      if (recordingPatch) {
        const { data: withRecording } = await db
          .from("meetings")
          .update({ ...snakeCasePatch(recordingPatch), updated_at: new Date().toISOString() })
          .eq("id", meetingId)
          .eq("status", "LIVE")
          .select("*, courses(id,title)")
          .maybeSingle();
        if (withRecording) data = withRecording;
      }
    } catch (recordingErr) {
      console.warn("[meeting] failed to start recording", recordingErr?.message || recordingErr);
    }
  }

  return { conflict: false, meeting: data };
}

/** Local snake_case converter for the small recording-field patch above — avoids pulling toSnake's "drop undefined" semantics into a path the race-condition test fakes don't implement `.select()` chaining differently for. */
function snakeCasePatch(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return out;
}

// Race condition fix: two admins clicking "Start" at nearly the same
// instant used to both pass a plain SELECT ... WHERE status='SCHEDULED'
// read (no lock), both create the same LiveKit room (idempotent
// no-op for the loser), then both attempt an UPDATE ... WHERE
// status='SCHEDULED'. Only one UPDATE could actually match — but the
// LOSER's code path then treated "0 rows updated" as "I lost, clean up
// the room I made", and called deleteRoom(current.room_name). Since
// both requests share the exact same room_name (it's fixed on the
// meeting row, not per-attempt), the loser was deleting the WINNER's
// just-started, actually-live room — leaving the meeting stuck at
// status=LIVE with no real LiveKit room behind it.
//
// Fixed by making the atomic UPDATE ... WHERE status='SCHEDULED' the
// *first* thing that happens (see startMeetingCore above). Only the
// single request whose UPDATE actually matches a row proceeds to talk
// to LiveKit at all; every other concurrent request gets zero rows
// back immediately and returns 409 without ever touching the LiveKit
// API, so there is no longer any window where a loser can delete a
// winner's room.
router.post("/:id/start", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await startMeetingCore(req.params.id, { supabase, liveKitApi, startRecording });
    if (result.conflict) return res.status(409).json({ error: "Meeting is not in a startable state." });
    await logAction({ actorId: req.user.id, action: "meeting.start", entityType: "Meeting", entityId: req.params.id });
    const shaped = row(result.meeting); shaped.course = shaped.courses || null; delete shaped.courses;
    res.json({ meeting: shaped });
  } catch (err) { next(err); }
});

router.post("/:id/end", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: current, error: loadError } = await supabase.from("meetings").select("*").eq("id", req.params.id).in("status", ["SCHEDULED", "LIVE"]).maybeSingle();
    assertNoError(loadError, "Failed to load meeting");
    if (!current) return res.status(409).json({ error: "Meeting is already ended or cancelled." });
    let recordingPatch = {};
    if (current.status === "LIVE") {
      // Stop the recording first, while the room (and LiveKit's own
      // record of the egress) still exists. Best-effort: LiveKit also
      // auto-stops room-composite egress once the room empties out, so
      // a failure here just means the webhook is the sole source of
      // truth for the final READY/FAILED state instead of also being
      // triggered by this explicit stop.
      if (current.recording_status === "RECORDING") {
        try {
          const patch = await stopRecording({ meeting: row(current), egressClient: liveKitApi().egress });
          if (patch) recordingPatch = { recording_status: patch.recordingStatus };
        } catch (err) {
          console.warn("[meeting] failed to stop recording", err?.message || err);
        }
      }
      try { await liveKitApi().room.deleteRoom(current.room_name); } catch (err) {
        console.warn("[meeting] LiveKit room cleanup failed", err?.message || err);
      }
    }
    const { data, error } = await supabase.from("meetings").update({ ...recordingPatch, status: "ENDED", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", req.params.id).in("status", ["SCHEDULED", "LIVE"]).select("*").maybeSingle();
    assertNoError(error, "Failed to end meeting");
    if (!data) return res.status(409).json({ error: "Meeting is already ended or cancelled." });
    await logAction({ actorId: req.user.id, action: "meeting.end", entityType: "Meeting", entityId: req.params.id });
    res.json({ meeting: row(data) });
  } catch (err) { next(err); }
});

// Admin Panel -> Meetings -> [Publish]: the recording already exists as
// a DRAFT `content` row (created by the egress_ended webhook — see
// meetingRecordingService.handleEgressEnded), so publishing it is just
// the normal content-publish transition. This route exists purely so
// the Meetings screen can do it in one click without an admin having to
// go find the matching row in the Content screen.
async function publishRecordingCore(meetingId, deps) {
  const { data: meetingData, error } = await deps.supabase.from("meetings").select("*").eq("id", meetingId).maybeSingle();
  assertNoError(error, "Failed to load meeting");
  if (!meetingData) return { status: 404, body: { error: "Meeting not found." } };
  const meeting = row(meetingData);
  // Defense in depth: even if a client somehow calls this on a meeting
  // that isn't actually READY (stale UI, replayed request, or a direct
  // API call bypassing the Meetings screen entirely), the state machine
  // is re-checked server-side rather than trusted from the request.
  // Content can ONLY ever be published from a recording this backend
  // itself created and marked READY — recordingContentId is never
  // client-supplied.
  if (meeting.recordingStatus !== "READY" || !meeting.recordingContentId) {
    return { status: 409, body: { error: "This meeting has no recording ready to publish yet." } };
  }
  const content = await deps.publishNow(meeting.recordingContentId);
  return { status: 200, body: { content }, meeting };
}

router.post("/:id/recording/publish", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const result = await publishRecordingCore(req.params.id, { supabase, publishNow: contentService.publishNow });
    if (result.status === 200) {
      await logAction({ actorId: req.user.id, action: "meeting.recording_publish", entityType: "Meeting", entityId: result.meeting.id, metadata: { contentId: result.body.content.id } });
    }
    res.status(result.status).json(result.body);
  } catch (err) { next(err); }
});

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { error } = await supabase.from("meetings").delete().eq("id", req.params.id).in("status", ["SCHEDULED", "CANCELLED"]);
    assertNoError(error, "Failed to delete meeting");
    await logAction({ actorId: req.user.id, action: "meeting.delete", entityType: "Meeting", entityId: req.params.id });
    res.status(204).end();
  } catch (err) { next(err); }
});


router.delete("/:id/participants/:identity", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("meetings").select("room_name,status").eq("id", req.params.id).maybeSingle();
    assertNoError(error, "Failed to load meeting");
    if (!data) return res.status(404).json({ error: "Meeting not found." });
    if (data.status !== "LIVE") return res.status(409).json({ error: "The meeting is not live." });
    await liveKitApi().room.removeParticipant(data.room_name, decodeURIComponent(req.params.identity));
    await logAction({ actorId: req.user.id, action: "meeting.participant_remove", entityType: "Meeting", entityId: req.params.id, metadata: { identity: decodeURIComponent(req.params.identity) } });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get("/:id/token", authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("meetings").select("*, courses(id,title)").eq("id", req.params.id).maybeSingle();
    assertNoError(error, "Failed to load meeting");
    if (!data) return res.status(404).json({ error: "Meeting not found." });
    const meeting = row(data);
    const isAdmin = req.user.role === "ADMIN";
    if (!isAdmin && !(await userCanAccessCourseForLiveMeeting(req.user.id, meeting.courseId))) return res.status(403).json({ error: "You do not have access to this course." });
    if (meeting.status !== "LIVE") return res.status(409).json({ error: "The meeting is not live yet." });

    const { apiKey, apiSecret, wsUrl } = requireLiveKitConfig();
    const token = new AccessToken(apiKey, apiSecret, {
      identity: req.user.id,
      name: req.user.name,
      ttl: "2h",
    });
    token.addGrant({ roomJoin: true, room: meeting.roomName, canPublish: true, canSubscribe: true, canPublishData: true });
    res.json({ token: await token.toJwt(), wsUrl, meeting: { ...meeting, course: meeting.courses || null } });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.startMeetingCore = startMeetingCore;
module.exports.publishRecordingCore = publishRecordingCore;
