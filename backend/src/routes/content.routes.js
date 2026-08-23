const express = require("express");
const { z } = require("zod");
const { supabase, row, rows, toSnake, assertNoError } = require("../lib/db");
const { deleteFileSafely } = require("../lib/storage");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { getAccessibleCourseIds, userCanAccessContent } = require("../services/accessService");
const contentService = require("../services/contentService");
const { logAction } = require("../services/auditService");
const { isSafeId, isValidContentFileKey } = require("../lib/fileValidation");
const { containsPattern } = require("../lib/searchFilter");
const { futureIsoDateTimeString } = require("../lib/dateValidation");

const router = express.Router();

// ---------------------------------------------------------------------------
// Student-facing feed
// ---------------------------------------------------------------------------

router.get("/", authenticate, async (req, res, next) => {
  try {
    const { type, courseId } = req.query;
    const accessibleCourseIds = Array.from(await getAccessibleCourseIds(req.user.id));

    if (accessibleCourseIds.length === 0) return res.json({ content: [] });
    if (courseId && !accessibleCourseIds.includes(courseId)) return res.json({ content: [] });

    let q = supabase
      .from("content")
      .select("*")
      .in("course_id", courseId ? [courseId] : accessibleCourseIds)
      .eq("status", "PUBLISHED");
    if (type) q = q.eq("type", type);

    const { data: contentData, error: contentError } = await q;
    assertNoError(contentError, "Failed to load content");
    const items = rows(contentData);

    // Join course titles + this user's progress for each item.
    // Batched (spec #13): one IN query for every distinct course
    // instead of one query per item (the old courseCache still made a
    // network round trip per *unique* course, which is still O(distinct
    // courses) instead of O(1)).
    const uniqueCourseIds = [...new Set(items.map((i) => i.courseId))];
    let coursesById = new Map();
    if (uniqueCourseIds.length > 0) {
      const { data: coursesData, error: coursesErr } = await supabase
        .from("courses")
        .select("id, title")
        .in("id", uniqueCourseIds);
      assertNoError(coursesErr, "Failed to load courses");
      coursesById = new Map(rows(coursesData).map((c) => [c.id, c]));
    }

    const { data: progressData, error: progressError } = await supabase
      .from("content_progress")
      .select("*")
      .eq("user_id", req.user.id);
    assertNoError(progressError, "Failed to load progress");
    const progressByContent = new Map(rows(progressData).map((p) => [p.contentId, p]));

    const shaped = items.map((item) => {
      const { fileKey, ...rest } = item;
      const progress = progressByContent.get(item.id);
      return {
        id: item.id,
        ...rest,
        hasFile: !!fileKey,
        course: coursesById.get(item.courseId) || null,
        progress: progress
          ? { percent: progress.progressPercent || 0, viewed: !!progress.viewed, lastPositionSeconds: progress.lastPositionSeconds ?? null }
          : { percent: 0, viewed: false, lastPositionSeconds: null },
      };
    });

    shaped.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
    res.json({ content: shaped });
  } catch (err) {
    next(err);
  }
});

router.get("/upcoming", authenticate, async (req, res, next) => {
  try {
    const accessibleCourseIds = Array.from(await getAccessibleCourseIds(req.user.id));
    if (accessibleCourseIds.length === 0) return res.json({ content: [] });

    const { data, error } = await supabase
      .from("content")
      .select("*")
      .in("course_id", accessibleCourseIds)
      .eq("status", "SCHEDULED");
    assertNoError(error, "Failed to load upcoming content");
    const items = rows(data);

    // Batched (spec #13), same as GET / above.
    const uniqueCourseIds = [...new Set(items.map((i) => i.courseId))];
    let coursesById = new Map();
    if (uniqueCourseIds.length > 0) {
      const { data: coursesData, error: coursesErr } = await supabase
        .from("courses")
        .select("id, title")
        .in("id", uniqueCourseIds);
      assertNoError(coursesErr, "Failed to load courses");
      coursesById = new Map(rows(coursesData).map((c) => [c.id, c]));
    }

    const shaped = items.map((item) => {
      const { fileKey, ...rest } = item;
      return { id: item.id, ...rest, course: coursesById.get(item.courseId) || null };
    });
    shaped.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    res.json({ content: shaped });
  } catch (err) {
    next(err);
  }
});

// Spec #11: progress must be validated against the actual content, not
// just its own internal range. `viewed`/`completed` are never accepted
// from the client as truth (spec #11E) — "viewed" is always derived
// server-side from the validated progress. When the content has a known
// duration, lastPositionSeconds is clamped to it (with a small
// tolerance for player rounding) and progressPercent is derived from
// position rather than trusted verbatim, so a client can't submit
// `{progressPercent: 100, lastPositionSeconds: 999999999}` and have it
// accepted at face value. Stored progressPercent is monotonic (spec
// #11D) — a legitimate rewind/seek can lower lastPositionSeconds
// (playback position) without erasing previously-earned completion
// credit; only a genuinely higher computed percent moves the stored
// value forward.
const PROGRESS_POSITION_TOLERANCE_SECONDS = 5;

/**
 * Pure — computes the server-authoritative progress for a single
 * /progress call, given the content's type/duration and the caller's
 * validated input. This is the fix for video-progress forgery: for
 * VIDEO content, a client-supplied `progressPercent` is NEVER trusted —
 * the return value is always derived from `lastPositionSeconds` and the
 * content's own stored duration, clamped to [0, 100]. A client sending
 * `{ progressPercent: 100 }` with no (or a bogus) position for a video
 * simply cannot move progress forward. PDF/POST content keeps the prior
 * model (a client-declared percent within its own 0-100 range — there
 * is no "position" concept for those types).
 *
 * Returns `{ ok: true, progressPercent, lastPositionSeconds }` or
 * `{ ok: false, error }` (never throws), so the route can turn a
 * rejection into a clean 400 without a try/catch.
 */
function computeServerProgress({ type, duration, progressPercent, lastPositionSeconds }) {
  if (type === "VIDEO") {
    if (lastPositionSeconds === undefined) {
      return { ok: false, error: "lastPositionSeconds is required to record progress for video content." };
    }
    if (!Number.isFinite(lastPositionSeconds) || lastPositionSeconds < 0) {
      return { ok: false, error: "lastPositionSeconds must not be negative." };
    }

    if (typeof duration === "number" && duration > 0) {
      if (lastPositionSeconds > duration + PROGRESS_POSITION_TOLERANCE_SECONDS) {
        return { ok: false, error: "lastPositionSeconds exceeds the content's duration." };
      }
      const clampedPosition = Math.min(lastPositionSeconds, duration);
      const derivedPercent = Math.max(0, Math.min(100, Math.round((clampedPosition / duration) * 100)));
      return { ok: true, progressPercent: derivedPercent, lastPositionSeconds: clampedPosition };
    }

    // Duration isn't known yet (e.g. never set at upload time). There is
    // no trustworthy basis to compute a percent, so completion is never
    // derived from thin air — but the position itself is still saved so
    // resume-from-last-position keeps working once duration is known.
    return { ok: true, progressPercent: undefined, lastPositionSeconds };
  }

  // PDF/POST: no server-verifiable "position" exists for these types —
  // a client-declared percent (already bounded to 0-100 by the zod
  // schema) is the appropriate model, same as before this fix.
  return { ok: true, progressPercent, lastPositionSeconds };
}

router.post("/:id/progress", authenticate, async (req, res, next) => {
  try {
    const schema = z.object({
      progressPercent: z.number().min(0).max(100).optional(),
      lastPositionSeconds: z.number().min(0).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    if (parsed.data.progressPercent === undefined && parsed.data.lastPositionSeconds === undefined) {
      return res.status(400).json({ error: "progressPercent or lastPositionSeconds is required." });
    }

    const { data: contentData, error: contentError } = await supabase
      .from("content")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    assertNoError(contentError, "Failed to load content");
    if (!contentData) return res.status(404).json({ error: "Content not found." });
    const content = row(contentData);

    if (!(await userCanAccessContent(req.user.id, content))) {
      return res.status(403).json({ error: "You do not have access to this content." });
    }

    const computed = computeServerProgress({
      type: content.type,
      duration: content.durationSeconds,
      progressPercent: parsed.data.progressPercent,
      lastPositionSeconds: parsed.data.lastPositionSeconds,
    });
    if (!computed.ok) return res.status(400).json({ error: computed.error });
    let { progressPercent, lastPositionSeconds } = computed;

    const progressId = `${req.user.id}_${content.id}`;
    const { data: existingProgress } = await supabase
      .from("content_progress")
      .select("progress_percent")
      .eq("id", progressId)
      .maybeSingle();
    const existingPercent = existingProgress ? Number(existingProgress.progress_percent) || 0 : 0;

    const finalPercent =
      progressPercent !== undefined ? Math.max(progressPercent, existingPercent) : existingPercent;
    const viewed = finalPercent >= 100;

    const update = {
      id: progressId,
      userId: req.user.id,
      contentId: content.id,
      progressPercent: finalPercent,
      viewed,
      ...(lastPositionSeconds !== undefined ? { lastPositionSeconds } : {}),
      updatedAt: new Date(),
    };
    const { error } = await supabase.from("content_progress").upsert(toSnake(update), { onConflict: "id" });
    assertNoError(error, "Failed to save progress");

    res.json({ progress: update });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin CRUD + publication workflow
// ---------------------------------------------------------------------------

const DEFAULT_ADMIN_PAGE_SIZE = 50;
const MAX_ADMIN_PAGE_SIZE = 200;

// Spec #12: search is now a DB-side `ilike` filter, so it's always
// bounded by `.limit()` (previously, supplying `search` skipped
// pagination entirely and loaded the whole table into Node.js memory).
// Spec #13: course titles are batched with one IN query instead of one
// query per unique course.
router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { status, type, courseId, search } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || DEFAULT_ADMIN_PAGE_SIZE, 1), MAX_ADMIN_PAGE_SIZE);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    let q = supabase.from("content").select("*");
    if (status) q = q.eq("status", status);
    if (type) q = q.eq("type", type);
    if (courseId) q = q.eq("course_id", courseId);
    if (search) q = q.ilike("title", containsPattern(search));
    q = q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data, error } = await q;
    assertNoError(error, "Failed to load content");
    const items = rows(data);

    const uniqueCourseIds = [...new Set(items.map((i) => i.courseId))];
    let coursesById = new Map();
    if (uniqueCourseIds.length > 0) {
      const { data: coursesData, error: coursesErr } = await supabase
        .from("courses")
        .select("id, title")
        .in("id", uniqueCourseIds);
      assertNoError(coursesErr, "Failed to load courses");
      coursesById = new Map(rows(coursesData).map((c) => [c.id, c]));
    }
    for (const item of items) item.course = coursesById.get(item.courseId) || null;

    res.json({ content: items });
  } catch (err) {
    next(err);
  }
});

// https:// only — blocks javascript:, data:, file: and any other scheme
// that a plain zod .url() check would otherwise let through. Prefer
// uploading a real image (see /api/upload) over an external URL.
const httpsUrl = z
  .string()
  .url()
  .refine((v) => v.toLowerCase().startsWith("https://"), { message: "imageUrl must use https://." });

const createContentSchema = z.object({
  // Optional: reuse the contentId reserved by POST /api/upload so the
  // Storage path (courses/{courseId}/.../{contentId}/...) and the DB
  // row id line up.
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(["VIDEO", "PDF", "POST"]),
  courseId: z.string().min(1),
  fileKey: z.string().optional(),
  fileSizeBytes: z.number().int().optional(),
  durationSeconds: z.number().int().optional(),
  pageCount: z.number().int().optional(),
  imageUrl: httpsUrl.optional().or(z.literal("")),
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = createContentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { id, fileKey, ...rest } = parsed.data;

    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id")
      .eq("id", rest.courseId)
      .maybeSingle();
    assertNoError(courseError, "Failed to load course");
    if (!course) return res.status(400).json({ error: "Course not found." });

    // Never let a client-supplied id silently overwrite existing content.
    if (id) {
      if (!isSafeId(id)) return res.status(400).json({ error: "Invalid content id." });
      const { data: existing } = await supabase.from("content").select("id").eq("id", id).maybeSingle();
      if (existing) return res.status(409).json({ error: "This content id is already in use." });
    }

    // Never trust a client-provided fileKey on its own (spec #6). It
    // must be the exact server-generated Storage path for THIS course,
    // THIS content id, and THIS content type — not merely start with an
    // expected prefix. Since the fileKey encodes the contentId that
    // reserved it (see /api/upload -> buildStoragePath), attaching one
    // requires the client to also supply that same id here, so the two
    // stay bound together.
    if (fileKey) {
      if (!id) {
        return res.status(400).json({ error: "An `id` matching the uploaded file's reserved content id is required when attaching a fileKey." });
      }
      const check = isValidContentFileKey({ fileKey, courseId: rest.courseId, contentId: id, type: rest.type });
      if (!check.ok) return res.status(400).json({ error: check.reason });
    }

    const data = {
      ...(id && isSafeId(id) ? { id } : {}),
      ...rest,
      fileKey: fileKey || null,
      status: "DRAFT",
      createdById: req.user.id,
      scheduledAt: null,
      publishedAt: null,
      unpublishedAt: null,
      archivedAt: null,
    };

    let created;
    try {
      const result = await supabase.from("content").insert(toSnake(data)).select("*").single();
      assertNoError(result.error, "Failed to create content");
      created = result.data;
    } catch (insertErr) {
      // Orphan-file prevention (spec #5D): the file at `fileKey` was
      // already uploaded to Storage by an earlier POST /api/upload call
      // before this request arrived. If the database row that was
      // supposed to own it never gets created, clean the object up
      // immediately instead of leaving an orphan for the background job
      // to find later.
      if (fileKey) {
        const cleanup = await deleteFileSafely(fileKey);
        console.error("[content.create] DB insert failed, cleaned up orphaned upload:", {
          fileKey,
          courseId: rest.courseId,
          cleanupOk: cleanup.ok,
        });
      }
      throw insertErr;
    }

    await logAction({ actorId: req.user.id, action: "content.create", entityType: "Content", entityId: created.id });
    res.status(201).json({ content: row(created) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = createContentSchema.omit({ id: true }).partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data: existingData, error: existingError } = await supabase
      .from("content")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    assertNoError(existingError, "Failed to load content");
    if (!existingData) return res.status(404).json({ error: "Content not found." });
    const existing = row(existingData);

    // Validate the FINAL contentId+courseId+type+fileKey combination
    // this update would produce — not just an incoming fileKey in
    // isolation. This is what prevents a courseId/type change from
    // silently leaving an old, now-mismatched file attached (see
    // resolveContentUpdateFileKey for the full rationale).
    let replacingFile;
    try {
      ({ replacingFile } = contentService.resolveContentUpdateFileKey({ existing, patch: parsed.data }));
    } catch (resolveErr) {
      if (resolveErr instanceof contentService.FileOwnershipError) {
        return res.status(resolveErr.status).json({ error: resolveErr.message });
      }
      throw resolveErr;
    }

    // Safe replacement (spec #15): the new file has already been
    // uploaded to Storage by the time this request arrives (the client
    // calls /api/upload first). We update the DB to point at the new
    // file *before* removing the old Storage object, so a crash between
    // the two never leaves content pointing at nothing.
    let updated;
    try {
      const result = await supabase
        .from("content")
        .update(toSnake({ ...parsed.data, updatedAt: new Date() }))
        .eq("id", req.params.id)
        .select("*")
        .single();
      assertNoError(result.error, "Failed to update content");
      updated = result.data;
    } catch (updateErr) {
      // Orphan-file prevention: if a new file was already uploaded for
      // this replacement (spec #5D) but the DB update that was supposed
      // to point at it fails, clean up the new object rather than the
      // still-referenced old one.
      if (replacingFile) {
        const cleanup = await deleteFileSafely(parsed.data.fileKey);
        console.error("[content.update] DB update failed, cleaned up orphaned replacement upload:", {
          fileKey: parsed.data.fileKey,
          contentId: req.params.id,
          cleanupOk: cleanup.ok,
        });
      }
      throw updateErr;
    }

    if (replacingFile) {
      await deleteFileSafely(existing.fileKey);
    }

    await logAction({ actorId: req.user.id, action: "content.update", entityType: "Content", entityId: req.params.id, metadata: parsed.data });
    res.json({ content: row(updated) });
  } catch (err) {
    next(err);
  }
});

// Reliable content deletion (spec fix — Storage/database consistency):
// the DB row deletion + Storage-cleanup queueing happen atomically in
// delete_content_cascade() (see supabase/schema.sql), the same durable
// pattern used for course deletion. This route then makes a
// best-effort immediate Storage delete for the file that was just
// queued; anything that fails stays PENDING/FAILED in
// storage_cleanup_queue and is retried by the existing
// storageCleanupRetryJob.js. A Storage failure can therefore never
// leave a dangling `fileKey` in the database — the DB row is already
// gone by the time we even attempt the Storage delete.
router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: queued, error: rpcError } = await supabase.rpc("delete_content_cascade", {
      p_content_id: req.params.id,
    });
    if (rpcError && rpcError.code === "P0002") {
      return res.status(404).json({ error: "Content not found." });
    }
    assertNoError(rpcError, "Failed to delete content");

    const files = rows(queued);
    let cleanedUp = 0;
    let stillPending = 0;
    await Promise.all(
      files.map(async (f) => {
        const result = await deleteFileSafely(f.fileKey);
        if (result.ok) {
          cleanedUp += 1;
          await supabase.from("storage_cleanup_queue").update({ status: "DONE", updated_at: new Date() }).eq("id", f.queueId);
        } else {
          stillPending += 1;
          await supabase
            .from("storage_cleanup_queue")
            .update({
              status: "FAILED",
              attempts: 1,
              last_error: String(result.error?.message || result.error || "unknown error"),
              updated_at: new Date(),
            })
            .eq("id", f.queueId);
        }
      })
    );

    await logAction({
      actorId: req.user.id,
      action: "content.delete",
      entityType: "Content",
      entityId: req.params.id,
      metadata: { fileKey: files[0]?.fileKey || null, filesCleanedUpImmediately: cleanedUp, filesPendingRetry: stillPending },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

function handleTransition(actionName, fn) {
  return async (req, res, next) => {
    try {
      const content = await fn(req.params.id, req.body);
      await logAction({
        actorId: req.user.id,
        action: `content.${actionName}`,
        entityType: "Content",
        entityId: content.id,
        metadata: req.body,
      });
      res.json({ content });
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Same as handleTransition, but validates req.body against `schema`
 * first (spec fix — "Validate Scheduled Dates"). Used for /schedule and
 * /reschedule so an invalid or missing `scheduledAt` is rejected with a
 * clean 400 before ever reaching contentService — which still re-checks
 * defensively itself (see lib/dateValidation.js).
 */
function handleValidatedTransition(actionName, schema, fn) {
  return async (req, res, next) => {
    try {
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
      const content = await fn(req.params.id, parsed.data);
      await logAction({
        actorId: req.user.id,
        action: `content.${actionName}`,
        entityType: "Content",
        entityId: content.id,
        metadata: parsed.data,
      });
      res.json({ content });
    } catch (err) {
      next(err);
    }
  };
}

const scheduleBodySchema = z.object({ scheduledAt: futureIsoDateTimeString });

router.post("/:id/publish", authenticate, requireAdmin, handleTransition("publish", (id) => contentService.publishNow(id)));
router.post(
  "/:id/schedule",
  authenticate,
  requireAdmin,
  handleValidatedTransition("schedule", scheduleBodySchema, (id, body) => contentService.schedule(id, body.scheduledAt))
);
router.post(
  "/:id/reschedule",
  authenticate,
  requireAdmin,
  handleValidatedTransition("reschedule", scheduleBodySchema, (id, body) => contentService.reschedule(id, body.scheduledAt))
);
router.post("/:id/unpublish", authenticate, requireAdmin, handleTransition("unpublish", (id) => contentService.unpublish(id)));
router.post("/:id/archive", authenticate, requireAdmin, handleTransition("archive", (id) => contentService.archive(id)));

module.exports = router;
module.exports.computeServerProgress = computeServerProgress;
module.exports.scheduleBodySchema = scheduleBodySchema;
