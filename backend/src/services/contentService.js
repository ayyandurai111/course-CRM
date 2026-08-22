const { supabase, row, toSnake, assertNoError } = require("../lib/db");
const { fileExists } = require("../lib/storage");
const { isValidContentFileKey, parseStoragePath } = require("../lib/fileValidation");

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

async function publishNow(contentId) {
  const content = await getContentOrThrow(contentId);
  assertTransition(content.status, "PUBLISHED");
  await assertFileReadyToPublish(content);
  return applyUpdate(contentId, { status: "PUBLISHED", publishedAt: new Date(), scheduledAt: null });
}

async function schedule(contentId, scheduledAt) {
  const content = await getContentOrThrow(contentId);
  if (new Date(scheduledAt) <= new Date()) {
    const err = new Error("scheduledAt must be in the future.");
    err.status = 400;
    throw err;
  }
  assertTransition(content.status, "SCHEDULED");
  return applyUpdate(contentId, { status: "SCHEDULED", scheduledAt: new Date(scheduledAt) });
}

async function reschedule(contentId, scheduledAt) {
  const content = await getContentOrThrow(contentId);
  if (content.status !== "SCHEDULED") {
    const err = new Error("Only SCHEDULED content can be rescheduled.");
    err.status = 400;
    throw err;
  }
  if (new Date(scheduledAt) <= new Date()) {
    const err = new Error("scheduledAt must be in the future.");
    err.status = 400;
    throw err;
  }
  return applyUpdate(contentId, { scheduledAt: new Date(scheduledAt) });
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
  for (const content of due) {
    try {
      await assertFileReadyToPublish(content);
    } catch (err) {
      skippedMissingFile += 1;
      console.error(`[publishDueScheduledContent] Skipping content ${content.id}: file not found in storage.`);
      continue;
    }
    await applyUpdate(content.id, { status: "PUBLISHED", publishedAt: new Date() });
    publishedCount += 1;
  }
  return { publishedCount, skippedMissingFile };
}

module.exports = {
  TRANSITIONS,
  InvalidTransitionError,
  NotFoundError,
  FileMissingError,
  FileOwnershipError,
  assertTransition,
  getContentOrThrow,
  resolveContentUpdateFileKey,
  assertFileOwnershipConsistent,
  publishNow,
  schedule,
  reschedule,
  unpublish,
  archive,
  publishDueScheduledContent,
};
