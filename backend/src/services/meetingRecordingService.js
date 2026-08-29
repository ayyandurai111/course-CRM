const crypto = require("crypto");
const { EncodedFileOutput, S3Upload, EncodedFileType, EgressStatus } = require("livekit-server-sdk");
const { supabase, row, toSnake, assertNoError } = require("../lib/db");
const { buildStoragePath } = require("../lib/fileValidation");
const { recordingS3Config, recordingEnabled, recordingTemplateBaseUrl } = require("../lib/recordingConfig");

/**
 * This module owns the middle of that pipeline: talking to LiveKit
 * Egress and turning its result into a DRAFT `content` row that the
 * existing publish flow (contentService.publishNow) already knows how
 * to take live. Every function here is best-effort on purpose — a
 * recording failing must never take down (or fail to end) the meeting
 * itself, since the live class is the thing people actually showed up
 * for.
 */

/**
 * Kicks off a RoomComposite recording for a meeting that's just gone
 * LIVE. Writes the output directly to the exact Storage path a
 * PUBLISHED VIDEO content row for this course would use, so no file
 * ever needs to be moved/copied later — "publish" is just flipping
 * status on a content row that already points at a real object.
 *
 * Returns the fields to persist on the meetings row, or null if
 * recording isn't configured / failed to start (meeting still goes
 * LIVE either way).
 */
async function startRecording({ meeting, egressClient }) {
  if (!recordingEnabled()) return null;
  const s3 = recordingS3Config();
  if (!s3) return null;

  try {
    const recordingContentId = crypto.randomUUID();
    const { storagePath } = buildStoragePath({
      courseId: meeting.courseId,
      contentId: recordingContentId,
      type: "VIDEO",
      ext: ".mp4",
    });

    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath: storagePath,
      output: {
        case: "s3",
        value: new S3Upload({
          accessKey: s3.accessKey,
          secret: s3.secret,
          region: s3.region,
          endpoint: s3.endpoint,
          bucket: s3.bucket,
          forcePathStyle: s3.forcePathStyle,
        }),
      },
    });

    // Custom layout (RecordingLayoutPage.tsx) when it's configured, so
    // the recorded file matches the live meeting's own spotlight/
    // filmstrip UI and speaking highlight — falls back to LiveKit's
    // built-in "grid" template (unchanged prior behavior) when it's
    // not, so recording never breaks over a missing/misconfigured URL.
    const customBaseUrl = recordingTemplateBaseUrl();
    const info = await egressClient.startRoomCompositeEgress(meeting.roomName, output, {
      layout: "grid",
      ...(customBaseUrl ? { customBaseUrl } : {}),
    });

    return {
      recordingStatus: "RECORDING",
      recordingEgressId: info.egressId,
      recordingContentId,
      recordingFileKey: storagePath,
      recordingError: null,
    };
  } catch (err) {
    console.warn("[meeting-recording] failed to start egress", err?.message || err);
    return { recordingStatus: "FAILED", recordingError: String(err?.message || err).slice(0, 500) };
  }
}

/** Best-effort stop, called when a meeting ends while still RECORDING. */
async function stopRecording({ meeting, egressClient }) {
  if (!meeting.recordingEgressId) return null;
  try {
    await egressClient.stopEgress(meeting.recordingEgressId);
    return { recordingStatus: "PROCESSING" };
  } catch (err) {
    console.warn("[meeting-recording] failed to stop egress", err?.message || err);
    // Leave recording_status as-is; the egress_ended webhook (LiveKit
    // stops egress automatically once the room empties out anyway) is
    // still the source of truth for the final READY/FAILED state.
    return null;
  }
}

/**
 * Handles LiveKit's `egress_ended` webhook event: finds the meeting
 * this egress belonged to, and on success creates the DRAFT `content`
 * row an admin can then Preview/Publish from the Meetings screen.
 *
 * `db` defaults to the real Supabase client and is only ever overridden
 * in tests (see meetingRecordingService.test.js), the same pattern
 * meetings.routes.js's startMeetingCore uses for its `deps.supabase`.
 */
async function handleEgressEnded(egressInfo, db = supabase) {
  const egressId = egressInfo.egressId;
  if (!egressId) return;

  const { data: meetingRow, error: findError } = await db
    .from("meetings")
    .select("*")
    .eq("recording_egress_id", egressId)
    .maybeSingle();
  assertNoError(findError, "Failed to load meeting for egress webhook");
  if (!meetingRow) return; // not one of ours (or already handled/cleared)
  const meeting = row(meetingRow);

  const failed = egressInfo.status === EgressStatus.EGRESS_FAILED || egressInfo.status === EgressStatus.EGRESS_ABORTED;
  const fileResult = Array.isArray(egressInfo.fileResults) ? egressInfo.fileResults[0] : null;

  if (failed || !fileResult) {
    await db
      .from("meetings")
      .update(
        toSnake({
          recordingStatus: "FAILED",
          recordingError: (egressInfo.error || "Recording did not produce a file.").slice(0, 500),
        })
      )
      .eq("id", meeting.id);
    return;
  }

  const durationSeconds = fileResult.duration ? Math.round(Number(fileResult.duration) / 1e9) : null; // ns -> s
  const fileSizeBytes = fileResult.size ? Number(fileResult.size) : null;

  // Create the DRAFT content row up front (not just on Publish) so an
  // admin can immediately Preview it from the Meetings screen — admins
  // bypass the PUBLISHED-only restriction in files.routes.js, so a
  // DRAFT row with a real fileKey is already fully previewable.
  const { error: insertError } = await db.from("content").insert(
    toSnake({
      id: meeting.recordingContentId,
      title: meeting.title,
      description: meeting.description || "",
      type: "VIDEO",
      courseId: meeting.courseId,
      fileKey: meeting.recordingFileKey,
      fileSizeBytes,
      durationSeconds,
      status: "DRAFT",
      createdById: meeting.createdById,
    })
  );

  if (insertError) {
    // Content row already exists (webhook redelivery) — not an error.
    if (insertError.code !== "23505") {
      console.error("[meeting-recording] failed to create content row from recording", insertError);
      await db
        .from("meetings")
        .update(toSnake({ recordingStatus: "FAILED", recordingError: "Failed to save recording as course content." }))
        .eq("id", meeting.id);
      return;
    }
  }

  await db
    .from("meetings")
    .update(
      toSnake({
        recordingStatus: "READY",
        recordingDurationSeconds: durationSeconds,
        recordingFileSizeBytes: fileSizeBytes,
        recordingError: null,
      })
    )
    .eq("id", meeting.id);
}

module.exports = { startRecording, stopRecording, handleEgressEnded };
