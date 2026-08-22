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

    let { progressPercent, lastPositionSeconds } = parsed.data;
    const duration = content.durationSeconds;

    if (typeof duration === "number" && duration > 0) {
      if (lastPositionSeconds !== undefined) {
        if (lastPositionSeconds > duration + PROGRESS_POSITION_TOLERANCE_SECONDS) {
          return res.status(400).json({ error: "lastPositionSeconds exceeds the content's duration." });
        }
        lastPositionSeconds = Math.min(lastPositionSeconds, duration);
        // Duration is known and trustworthy, so percent is *derived*
        // from position rather than taken from the client — this is
        // what actually stops `{progressPercent: 100, lastPositionSeconds: 0}`-
        // style forgery from being recorded as real progress.
        progressPercent = Math.round((lastPositionSeconds / duration) * 100);
      } else if (progressPercent !== undefined) {
        // No position this call (e.g. a PDF/POST "mark viewed" ping) —
        // trust the submitted percent within its own declared 0-100 range.
      }
    }

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

router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("content").select("file_key").eq("id", req.params.id).maybeSingle();
    assertNoError(error, "Failed to load content");
    if (!data) return res.status(404).json({ error: "Content not found." });
    const fileKey = data.file_key;

    // Storage cleanup (spec #14): delete the Storage object before the
    // DB row, so a failure here doesn't orphan a file with no metadata
    // pointing anyone at it for cleanup.
    const { ok } = await deleteFileSafely(fileKey);
    if (!ok) {
      return res.status(500).json({ error: "Could not delete the stored file. Content was not deleted; please retry." });
    }

    const { error: deleteError } = await supabase.from("content").delete().eq("id", req.params.id);
    assertNoError(deleteError, "Failed to delete content");
    await logAction({ actorId: req.user.id, action: "content.delete", entityType: "Content", entityId: req.params.id, metadata: { fileKey } });
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

router.post("/:id/publish", authenticate, requireAdmin, handleTransition("publish", (id) => contentService.publishNow(id)));
router.post("/:id/schedule", authenticate, requireAdmin, handleTransition("schedule", (id, body) => contentService.schedule(id, body.scheduledAt)));
router.post("/:id/reschedule", authenticate, requireAdmin, handleTransition("reschedule", (id, body) => contentService.reschedule(id, body.scheduledAt)));
router.post("/:id/unpublish", authenticate, requireAdmin, handleTransition("unpublish", (id) => contentService.unpublish(id)));
router.post("/:id/archive", authenticate, requireAdmin, handleTransition("archive", (id) => contentService.archive(id)));

module.exports = router;
