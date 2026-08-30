const crypto = require("crypto");
const { EncodedFileOutput, S3Upload, EncodedFileType, EgressStatus } = require("livekit-server-sdk");
const { supabase, row, toSnake, assertNoError } = require("../../../shared/backend-core/db");
const { buildStoragePath } = require("../../storage-upload/backend/fileValidation.lib");
const { recordingS3Config, recordingEnabled, recordingTemplateBaseUrl } = require("./recordingConfig.lib");

/**
 * Live Meeting -> Meeting முடியும் (ends) -> Recording உருவாகும் (is
 * created) -> Recording Storage-ல் save ஆகும் (saved to Storage) ->
 * Admin Panel -> Meetings -> [Preview] [Publish] -> Course Content-ல்
 * Video -> Student -> Normal Video Player.
 *
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
 * Handles someone (currently: an admin — see meetings.routes.js's
 * GET /:id/token) rejoining a meeting that's still LIVE but whose
 * recording isn't currently RECORDING. That combination only happens
 * when the earlier egress already stopped on its own — LiveKit stops
 * RoomComposite egress once its room has zero participants, which is
 * exactly what "everyone left, including the admin" looks like from
 * Egress's point of view. There's no way to resume a stopped egress
 * mid-file, so this archives whatever the last segment produced (if
 * anything) into meeting_recording_segments and starts a fresh one,
 * so the class continues being recorded from the moment someone is
 * back in the room, instead of silently staying unrecorded for the
 * rest of the class.
 *
 * Best-effort like the rest of this module: rejoining the meeting
 * must never fail just because this bookkeeping did.
 */
async function resumeRecordingIfDropped({ meeting, egressClient, db }) {
  if (!recordingEnabled()) return null;
  if (meeting.recordingStatus === "RECORDING" || meeting.recordingStatus === "NONE") return null;

  try {
    if (meeting.recordingEgressId) {
      const { count, error: countError } = await db
        .from("meeting_recording_segments")
        .select("id", { count: "exact", head: true })
        .eq("meeting_id", meeting.id);
      assertNoError(countError, "Failed to count existing recording segments");
      await db.from("meeting_recording_segments").insert(
        toSnake({
          meetingId: meeting.id,
          segmentNumber: (count || 0) + 1,
          status: meeting.recordingStatus === "READY" ? "READY" : meeting.recordingStatus === "FAILED" ? "FAILED" : "PROCESSING",
          egressId: meeting.recordingEgressId,
          contentId: meeting.recordingContentId,
          fileKey: meeting.recordingFileKey,
          durationSeconds: meeting.recordingDurationSeconds,
          fileSizeBytes: meeting.recordingFileSizeBytes,
          error: meeting.recordingError,
        })
      );
    }

    const started = await startRecording({ meeting, egressClient });
    if (!started) return null;

    const { data, error } = await db
      .from("meetings")
      .update(toSnake(started))
      .eq("id", meeting.id)
      .select("*, courses(id,title)")
      .maybeSingle();
    assertNoError(error, "Failed to persist resumed recording");
    return data;
  } catch (err) {
    console.warn("[meeting-recording] failed to resume recording on rejoin", err?.message || err);
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

  if (!meetingRow) {
    // Not the CURRENT segment — either not ours at all, or this event
    // belongs to an earlier segment that's already been superseded by
    // a resumed recording (see resumeRecordingIfDropped above), whose
    // archived row is what needs updating instead of the meetings row.
    await handleEgressEndedForArchivedSegment(egressInfo, db);
    return;
  }
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

/**
 * Same finalization as the block above, but for a segment that's
 * already been archived to meeting_recording_segments (its egress id
 * no longer matches any meetings row because a rejoin already started
 * a newer segment before this webhook arrived).
 */
async function handleEgressEndedForArchivedSegment(egressInfo, db) {
  const egressId = egressInfo.egressId;
  const { data: segmentRow, error: findError } = await db
    .from("meeting_recording_segments")
    .select("*")
    .eq("egress_id", egressId)
    .maybeSingle();
  assertNoError(findError, "Failed to load recording segment for egress webhook");
  if (!segmentRow) return; // not one of ours
  const segment = row(segmentRow);

  const failed = egressInfo.status === EgressStatus.EGRESS_FAILED || egressInfo.status === EgressStatus.EGRESS_ABORTED;
  const fileResult = Array.isArray(egressInfo.fileResults) ? egressInfo.fileResults[0] : null;

  if (failed || !fileResult) {
    await db
      .from("meeting_recording_segments")
      .update(toSnake({ status: "FAILED", error: (egressInfo.error || "Recording did not produce a file.").slice(0, 500) }))
      .eq("id", segment.id);
    return;
  }

  const durationSeconds = fileResult.duration ? Math.round(Number(fileResult.duration) / 1e9) : null;
  const fileSizeBytes = fileResult.size ? Number(fileResult.size) : null;

  const { data: meetingRow } = await db.from("meetings").select("title,description,course_id,created_by_id").eq("id", segment.meetingId).maybeSingle();

  if (meetingRow && segment.contentId) {
    const { error: insertError } = await db.from("content").insert(
      toSnake({
        id: segment.contentId,
        title: meetingRow.title,
        description: meetingRow.description || "",
        type: "VIDEO",
        courseId: meetingRow.course_id,
        fileKey: segment.fileKey,
        fileSizeBytes,
        durationSeconds,
        status: "DRAFT",
        createdById: meetingRow.created_by_id,
      })
    );
    if (insertError && insertError.code !== "23505") {
      console.error("[meeting-recording] failed to create content row from archived segment", insertError);
      await db.from("meeting_recording_segments").update(toSnake({ status: "FAILED", error: "Failed to save recording as course content." })).eq("id", segment.id);
      return;
    }
  }

  await db
    .from("meeting_recording_segments")
    .update(toSnake({ status: "READY", durationSeconds, fileSizeBytes, error: null }))
    .eq("id", segment.id);
}

module.exports = { startRecording, stopRecording, resumeRecordingIfDropped, handleEgressEnded };
