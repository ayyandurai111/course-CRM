const express = require("express");
const { WebhookReceiver, LiveKitAPI } = require("livekit-server-sdk");
const { handleEgressEnded: realHandleEgressEnded, resumeRecordingIfDropped: realResumeRecordingIfDropped, stopRecording: realStopRecording } = require("./meetingRecordingService");
const { supabase: realSupabase, row, toSnake } = require("../../../shared/backend-core/db");
const { recordingEnabled: realRecordingEnabled } = require("./recordingConfig.lib");

/**
 * Builds the LiveKit webhook router. `deps.handleEgressEnded` defaults
 * to the real service function; tests override it so the route's HTTP
 * layer (signature verification, status codes, event-type dispatch)
 * can be exercised against a real Express app + real
 * WebhookReceiver/AccessToken signing, without needing a live Supabase
 * connection. See meetings.routes.js's `startMeetingCore(id, deps)`
 * for the same pattern.
 */
function createLivekitWebhookRouter(deps = {}) {
  const handleEgressEnded = deps.handleEgressEnded || realHandleEgressEnded;
  const resumeRecordingIfDropped = deps.resumeRecordingIfDropped || realResumeRecordingIfDropped;
  const stopRecording = deps.stopRecording || realStopRecording;
  const supabase = deps.supabase || realSupabase;
  const recordingEnabled = deps.recordingEnabled || realRecordingEnabled;
  const router = express.Router();

  let receiver = null;
  function webhookReceiver() {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return null;
    // Deliberately not cached across differing apiKey/apiSecret env
    // values (tests flip these between cases) — cheap to construct.
    if (!receiver || receiver.__apiKey !== apiKey || receiver.__apiSecret !== apiSecret) {
      receiver = new WebhookReceiver(apiKey, apiSecret);
      receiver.__apiKey = apiKey;
      receiver.__apiSecret = apiSecret;
    }
    return receiver;
  }

  let liveKitApi = null;
  function liveKitEgress() {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_WS_URL || process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) return null;
    if (!liveKitApi) {
      let host;
      try {
        const parsed = new URL(wsUrl);
        host = `${parsed.protocol === "wss:" ? "https:" : "http:"}//${parsed.host}`;
      } catch {
        return null;
      }
      liveKitApi = new LiveKitAPI({ host, apiKey, secret: apiSecret });
    }
    return liveKitApi.egress;
  }

  // LiveKit signs this payload with the same API key/secret used to talk
  // to LiveKit's own API, so WebhookReceiver.receive() both verifies the
  // request actually came from our LiveKit deployment AND parses it —
  // there is no separate shared-secret to configure. This route is
  // mounted (see index.js) with a raw-body parser ahead of the global
  // express.json(), since the signature is computed over the exact raw
  // bytes LiveKit sent.
  router.post("/", async (req, res) => {
    const wr = webhookReceiver();
    if (!wr) {
      // Recording isn't configured on this deployment; nothing to verify
      // or act on. 200 so LiveKit doesn't retry forever.
      return res.status(200).end();
    }

    let event;
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body || "");
      event = await wr.receive(rawBody, req.get("Authorization"));
    } catch (err) {
      console.warn("[livekit-webhook] signature verification failed", err?.message || err);
      return res.status(401).end();
    }

    try {
      if (event.event === "egress_ended" && event.egressInfo) {
        await handleEgressEnded(event.egressInfo);
      } else if (event.event === "room_started" && event.room?.name && recordingEnabled()) {
        await handleRoomStarted(event.room.name, { resumeRecordingIfDropped, supabase, liveKitEgress });
      } else if (event.event === "participant_left" && event.room?.name && event.participant && recordingEnabled()) {
        await handleParticipantLeft(event.room.name, event.participant, { stopRecording, supabase, liveKitEgress });
      }
    } catch (err) {
      // Log and still 200 — LiveKit will retry a 4xx/5xx indefinitely,
      // and a bug in our own bookkeeping shouldn't hold up its delivery
      // queue. The meeting stays in PROCESSING and is visible to admins
      // as needing attention rather than silently stuck.
      console.error("[livekit-webhook] failed to process event", event?.event, err);
    }

    res.status(200).end();
  });

  return router;
}

/**
 * A room only genuinely exists — and can have an egress started
 * against it — once LiveKit's own `room_started` event fires, which
 * only happens after a participant has actually connected. This is
 * the correct trigger for resumeRecordingIfDropped (see
 * meetingRecordingService.js's doc comment on that function): trying
 * to resume at token-issue time (as an earlier version of this did)
 * races against the room not existing yet and can fail outright.
 *
 * Every LIVE meeting's room_name is unique per-meeting (see
 * startMeetingCore), so this only ever matches at most one meeting.
 */
async function handleRoomStarted(roomName, { resumeRecordingIfDropped, supabase, liveKitEgress }) {
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("room_name", roomName)
    .eq("status", "LIVE")
    .maybeSingle();
  if (error) {
    console.error("[livekit-webhook] failed to load meeting for room_started", error);
    return;
  }
  if (!data) return; // not a meeting room, or already ended

  const egressClient = liveKitEgress();
  if (!egressClient) return; // recording not configured on this deployment

  await resumeRecordingIfDropped({ meeting: row(data), egressClient, db: supabase });
}

/**
 * The admin leaving is treated as "stop recording now" rather than
 * waiting for LiveKit's own room-empty timeout to notice and auto-stop
 * the egress — that timeout is tuned for reclaiming idle server
 * resources, not for "the teacher just ended class," and can leave a
 * recording running for several extra minutes of a now-empty room
 * after the person who was actually teaching has left.
 *
 * Deliberately keyed on the ADMIN's participant metadata (set at
 * token-issue time — see meetings.routes.js's GET /:id/token), not on
 * "the room is now empty": a student leaving while the admin is still
 * present must NOT stop the recording, and checking room emptiness
 * here would need a second API round-trip (list remaining
 * participants) that's redundant with just checking who left.
 *
 * If the admin later rejoins the still-LIVE meeting, room_started
 * fires again and resumeRecordingIfDropped starts a fresh segment —
 * see handleRoomStarted above.
 */
async function handleParticipantLeft(roomName, participant, { stopRecording, supabase, liveKitEgress }) {
  let metadata = {};
  try { metadata = JSON.parse(participant.metadata || "{}"); } catch { /* not JSON — not one of our tokens */ }
  if (metadata.role !== "ADMIN") return;

  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("room_name", roomName)
    .eq("status", "LIVE")
    .maybeSingle();
  if (error) {
    console.error("[livekit-webhook] failed to load meeting for participant_left", error);
    return;
  }
  if (!data) return;
  const meeting = row(data);
  if (meeting.recordingStatus !== "RECORDING") return; // nothing currently running to stop

  const egressClient = liveKitEgress();
  if (!egressClient) return;

  const patch = await stopRecording({ meeting, egressClient });
  if (patch) {
    await supabase.from("meetings").update(toSnake(patch)).eq("id", meeting.id);
  }
}

module.exports = createLivekitWebhookRouter();
module.exports.createLivekitWebhookRouter = createLivekitWebhookRouter;
