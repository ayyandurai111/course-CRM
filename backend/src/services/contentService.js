const { supabase, row, toSnake, assertNoError } = require("../lib/db");
const { fileExists } = require("../lib/storage");
const { isValidContentFileKey, parseStoragePath } = require("../lib/fileValidation");
const { parseValidDate } = require("../lib/dateValidation");

/**
 * Valid transitions for the content publication state machine.
 *   DRAFT -> SCHEDULED -> PUBLISHED -> UNPUBLISHED / ARCHIVED
 *   DRAFT -> PUBLISHED (publish immediately)
 *   UNPUBLISHED -> PUBLISHED (republish) / ARCHIVED
 */
const TRANSITIONS = {
  DRAFT: ["SCHEDULED", "PUBLISHED", "ARCHIVED"],
  SCHEDULED: ["PUBLISHED", "DRAFT", "ARCHIVED"],
  PUBLISHED: ["UNPUBLISHED", "ARCHIVED"],
  UNPUBLISHED: ["PUBLISHED", "SCHEDULED", "ARCHIVED"],
  ARCHIVED: [],
};

class InvalidTransitionError extends Error {
  constructor(from, to) {
    super(`Cannot move content from ${from} to ${to}.`);
    this.status = 400;
  }
}

class NotFoundError extends Error {
  constructor(id) {
    super(`Content ${id} not found.`);
    this.status = 404;
  }
}

class FileMissingError extends Error {
  constructor(id) {
    super("The uploaded file for this content could not be found in storage. Please re-upload before publishing.");
    this.status = 409;
  }
}

/**
 * Thrown whenever a content record's contentId + courseId + type +
 * fileKey would not (or does not) form a single valid, authorized file
 * relationship — the fix for the file-ownership-mismatch bug. Used
 * both when validating an incoming PATCH (status 400 — the admin's own
 * request is rejected) and, as defense-in-depth, when a record already
 * in the database turns out to be inconsistent right before it would
 * be published (status 409).
 */
class FileOwnershipError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Thrown when the atomic publish commit (publish_content_atomic RPC)
 * discovers that the content row changed between the moment this
 * request validated it (including the Storage existence check) and the
 * moment it tried to commit PUBLISHED — i.e. a genuine concurrent
 * modification was caught and rejected rather than silently allowed to
 * produce an inconsistent published record. The caller should treat
 * this like any other optimistic-concurrency conflict: safe to retry.
 */
class PublishConflictError extends Error {
  constructor(contentId) {
    super(`Content ${contentId} was modified concurrently and could not be published as validated. Please retry.`);
    this.status = 409;
  }
}

/**
 * Given a content record's current state and an incoming PATCH body,
 * decides the FINAL courseId/type/fileKey this content would have if
 * the patch were applied, and enforces that this final combination is
 * a single valid, authorized file relationship before allowing the
 * caller to save it.
 *
 * This closes the file-ownership-mismatch bug: previously, an incoming
 * fileKey was validated against the new courseId/type, but an EXISTING
 * fileKey carried forward untouched (because the admin didn't upload a
 * new file) was never re-checked against a courseId/type change — so a
 * file that was only ever valid for Course A could keep sitting on
 * content that now belongs to Course B.
 *
 * - A client-supplied fileKey (a genuine new upload) is always
 *   re-validated against the FINAL courseId/type/contentId. Because a
 *   fileKey's Storage path embeds its courseId, this also rejects an
 *   attacker manually pasting another course's fileKey — it simply
 *   can't match the target course.
 * - No fileKey in the patch means "keep the existing file" — but that
 *   existing fileKey is then re-validated against the FINAL
 *   courseId/type too. If a courseId/type change makes the old file's
 *   path no longer match, the update is rejected: the admin must
 *   upload a replacement file (which arrives as a fileKey in the
 *   patch) or leave courseId/type unchanged. This project intentionally
 *   prefers rejecting the change over silently dropping the file.
 */
function resolveContentUpdateFileKey({ existing, patch }) {
  const courseId = (patch && patch.courseId) || existing.courseId;
  const type = (patch && patch.type) || existing.type;
  const newFileKeyProvided = typeof (patch && patch.fileKey) === "string" && patch.fileKey.length > 0;
  const finalFileKey = newFileKeyProvided ? patch.fileKey : existing.fileKey || null;

  if (finalFileKey) {
    const check = isValidContentFileKey({ fileKey: finalFileKey, courseId, contentId: existing.id, type });
    if (!check.ok) {
      throw new FileOwnershipError(
        newFileKeyProvided
          ? check.reason
          : "This change would leave the existing file attached to the wrong course or an incompatible content type. Upload a replacement file for the new course/type before saving this change."
      );
    }
  }

  return {
    courseId,
    type,
    fileKey: finalFileKey,
    replacingFile: newFileKeyProvided && !!existing.fileKey && finalFileKey !== existing.fileKey,
  };
}

/**
 * Cheap, no-I/O defense-in-depth check: re-derives what a content
 * record's fileKey path is required to look like from the record's own
 * courseId/id/type and confirms it still matches exactly. Guards the
 * publish transition against any bug or manual DB edit elsewhere ever
 * violating the contentId+courseId+type+fileKey invariant, not just
 * the PATCH path above.
 */
function assertFileOwnershipConsistent(content) {
  if (!content.fileKey) return;
  const parsed = parseStoragePath(content.fileKey);
  const consistent =
    !!parsed && parsed.courseId === content.courseId && parsed.contentId === content.id && parsed.type === content.type;
  if (!consistent) {
    throw new FileOwnershipError(
      "This content's file no longer matches its course/type and cannot be published. Re-attach a valid file for this course/type first.",
      409
    );
  }
}

function assertTransition(from, to) {
  if (!TRANSITIONS[from] || !TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

async function getContentOrThrow(contentId) {
  const { data, error } = await supabase.from("content").select("*").eq("id", contentId).maybeSingle();
  assertNoError(error, "Failed to load content");
  if (!data) throw new NotFoundError(contentId);
  return row(data);
}

async function applyUpdate(contentId, update) {
  const { data, error } = await supabase
    .from("content")
    .update(toSnake(update))
    .eq("id", contentId)
    .select("*")
    .single();
  assertNoError(error, "Failed to update content");
  return row(data);
}

/**
 * Spec #6E: verify the Storage object a content record claims still
 * exists before letting it become visible to students. This is
 * deliberately only called on the publish path (not on every read) —
 * an existence check is a real Storage API call, so gating it to the
 * publish transition keeps normal browsing/reading cheap.
 */
async function assertFileReadyToPublish(content) {
  if (!content.fileKey) return; // POST/text content may have no file at all
  assertFileOwnershipConsistent(content);
  const exists = await fileExists(content.fileKey);
  if (!exists) throw new FileMissingError(content.id);
}

/**
 * Commits the actual PUBLISHED transition via the atomic
 * publish_content_atomic() Postgres function (see supabase/schema.sql).
 * `content` must be a snapshot that has ALREADY passed
 * assertFileReadyToPublish() (ownership consistency + the Storage
 * existence check) — this function re-verifies that exact snapshot is
 * still current, atomically, at commit time, and fails with
 * PublishConflictError if anything about it (courseId/type/fileKey)
 * changed in between. This is the fix for the publish race condition:
 * the window between "we checked the file exists" and "we wrote
 * PUBLISHED" is now closed by a row-locked, compare-and-swap commit
 * instead of an unconditional blind write.
 */
/** Pure — the arguments this content's snapshot must send to publish_content_atomic(). */
function buildPublishRpcArgs(content) {
  return {
    p_content_id: content.id,
    p_expected_course_id: content.courseId,
    p_expected_type: content.type,
    p_expected_file_key: content.fileKey || null,
  };
}

/**
 * Pure — translates a Postgres errcode from publish_content_atomic()
 * into the right typed application error. Kept separate from
 * commitPublish so this mapping is unit-testable without a live DB.
 */
function mapPublishRpcError(error, content) {
  if (error.code === "40001") return new PublishConflictError(content.id);
  if (error.code === "P0002") return new NotFoundError(content.id);
  if (error.code === "23514") return new InvalidTransitionError(content.status, "PUBLISHED");
  const err = new Error(`Failed to publish content: ${error.message}`);
  err.cause = error;
  return err;
}

async function commitPublish(content) {
  const { data, error } = await supabase.rpc("publish_content_atomic", buildPublishRpcArgs(content));
  if (error) throw mapPublishRpcError(error, content);

  const published = Array.isArray(data) ? data[0] : data;
  if (!published) throw new NotFoundError(content.id);
  return row(published);
}

async function publishNow(contentId) {
  const content = await getContentOrThrow(contentId);
  assertTransition(content.status, "PUBLISHED");
  await assertFileReadyToPublish(content);
  return commitPublish(content);
}

async function schedule(contentId, scheduledAt) {
  const content = await getContentOrThrow(contentId);
  // Spec fix — see lib/dateValidation.js doc comment: never compare a
  // possibly-invalid Date. This is a defense-in-depth check — the
  // /schedule route already validates scheduledAt with zod before
  // calling here — so this service can never be tricked into scheduling
  // invalid or past-dated content even if called from elsewhere.
  const parsedDate = parseValidDate(scheduledAt);
  if (!parsedDate) {
    const err = new Error("scheduledAt must be a valid date/time.");
    err.status = 400;
    throw err;
  }
  if (parsedDate.getTime() <= Date.now()) {
    const err = new Error("scheduledAt must be in the future.");
    err.status = 400;
    throw err;
  }
  assertTransition(content.status, "SCHEDULED");
  return applyUpdate(contentId, { status: "SCHEDULED", scheduledAt: parsedDate });
}

async function reschedule(contentId, scheduledAt) {
  const content = await getContentOrThrow(contentId);
  if (content.status !== "SCHEDULED") {
    const err = new Error("Only SCHEDULED content can be rescheduled.");
    err.status = 400;
    throw err;
  }
  const parsedDate = parseValidDate(scheduledAt);
  if (!parsedDate) {
    const err = new Error("scheduledAt must be a valid date/time.");
    err.status = 400;
    throw err;
  }
  if (parsedDate.getTime() <= Date.now()) {
    const err = new Error("scheduledAt must be in the future.");
    err.status = 400;
    throw err;
  }
  return applyUpdate(contentId, { scheduledAt: parsedDate });
}

async function unpublish(contentId) {
  const content = await getContentOrThrow(contentId);
  assertTransition(content.status, "UNPUBLISHED");
  return applyUpdate(contentId, { status: "UNPUBLISHED", unpublishedAt: new Date() });
}

async function archive(contentId) {
  const content = await getContentOrThrow(contentId);
  assertTransition(content.status, "ARCHIVED");
  return applyUpdate(contentId, { status: "ARCHIVED", archivedAt: new Date() });
}

/**
 * Idempotently flips any content whose scheduledAt has passed to
 * PUBLISHED. Each due item's Storage object is verified to exist first
 * (spec #6E) — an item whose file went missing (e.g. a Storage-side
 * incident) is skipped and stays SCHEDULED rather than silently going
 * live with a broken link; it will be retried on the next run. This
 * runs the check-then-update per row instead of the single bulk SQL
 * UPDATE the old publish_due_scheduled_content() RPC used, which is an
 * acceptable trade-off since "due scheduled" volume per minute is small
 * (spec explicitly allows the Storage check "when required" — i.e. on
 * the publish transition, not on every read).
 */
async function publishDueScheduledContent() {
  const { data, error } = await supabase
    .from("content")
    .select("*")
    .eq("status", "SCHEDULED")
    .lte("scheduled_at", new Date().toISOString());
  assertNoError(error, "Failed to load due scheduled content");
  const due = (data || []).map(row);

  let publishedCount = 0;
  let skippedMissingFile = 0;
  let skippedConflict = 0;
  for (const content of due) {
    try {
      await assertFileReadyToPublish(content);
    } catch (err) {
      skippedMissingFile += 1;
      console.error(`[publishDueScheduledContent] Skipping content ${content.id}: file not found in storage.`);
      continue;
    }
    try {
      // Same atomic, race-safe commit as the manual publish path — an
      // admin editing this exact item (new file, course move, etc.) at
      // the same moment the scheduler wakes up is caught here too,
      // instead of the scheduler blindly overwriting status.
      await commitPublish(content);
      publishedCount += 1;
    } catch (err) {
      if (err instanceof PublishConflictError) {
        skippedConflict += 1;
        console.error(`[publishDueScheduledContent] Skipping content ${content.id}: modified concurrently, will retry next run.`);
        continue;
      }
      throw err;
    }
  }
  return { publishedCount, skippedMissingFile, skippedConflict };
}

module.exports = {
  TRANSITIONS,
  InvalidTransitionError,
  NotFoundError,
  FileMissingError,
  FileOwnershipError,
  PublishConflictError,
  assertTransition,
  getContentOrThrow,
  resolveContentUpdateFileKey,
  assertFileOwnershipConsistent,
  buildPublishRpcArgs,
  mapPublishRpcError,
  commitPublish,
  publishNow,
  schedule,
  reschedule,
  unpublish,
  archive,
  publishDueScheduledContent,
};
