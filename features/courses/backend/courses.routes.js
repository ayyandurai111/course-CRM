const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { isAllowedHttpsImageUrl } = require("../../../shared/backend-core/urlSecurity");
const { z } = require("zod");
const { supabase, row, rows, toSnake, assertNoError } = require("../../../shared/backend-core/db");
const { deleteFileSafely, uploadPublicImage } = require("../../storage-upload/backend/storage.lib");
const { authenticate, requireAdmin } = require("../../auth/backend/auth.middleware");
const { logAction } = require("../../audit/backend/auditService");
const {
  maxSizeBytesFor,
  safeExtension,
  isExtensionAllowed,
  isMimeAllowed,
  matchesFileSignature,
} = require("../../storage-upload/backend/fileValidation.lib");

const router = express.Router();

function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Race condition fix: this used to be a plain "SELECT to check if the
 * slug is taken, then INSERT" — a classic TOCTOU gap. Two admins
 * creating a course with the same title at nearly the same instant
 * could both run the SELECT before either INSERT landed, both see the
 * slug as free, and both attempt to insert the identical slug. The
 * `slug` column's `unique` constraint stops the actual duplicate row
 * from being created, but the LOSING request's insert then failed with
 * a raw, uncaught Postgres unique_violation (23505), surfaced to the
 * admin as an opaque 500 instead of just... getting a working course
 * created, which is what should happen (the whole point of the "-1,
 * -2, ..." suffix loop is to make slug collisions a non-event).
 *
 * Fixed by making the INSERT itself the authority: attempt the base
 * slug, and on a slug-unique-violation, retry with the next numeric
 * suffix — no separate, non-atomic pre-check. This closes the race
 * instead of just narrowing its window, since the database's own
 * constraint is what decides "is this slug taken", checked at the
 * exact moment of the write.
 */
const MAX_SLUG_INSERT_ATTEMPTS = 10;

async function insertCourseWithUniqueSlug({ title, ...rest }) {
  const baseSlug = slugify(title);
  let lastError;
  for (let attempt = 0; attempt < MAX_SLUG_INSERT_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt}`;
    const { data, error } = await supabase
      .from("courses")
      .insert(toSnake({ title, ...rest, slug }))
      .select("*")
      .single();
    if (!error) return data;
    // 23505 = unique_violation. `slug` is the only unique column on
    // this table besides the id primary key (which we never set
    // ourselves — it's the DB default), so any unique_violation here is
    // a slug collision; retry with the next suffix rather than assuming
    // and swallowing something unrelated.
    if (error.code === "23505") {
      lastError = error;
      continue;
    }
    const err = new Error(`Failed to create course: ${error.message}`);
    err.cause = error;
    throw err;
  }
  const err = new Error("Could not generate a unique URL slug for this course title. Try a slightly different title.");
  err.status = 409;
  err.cause = lastError;
  throw err;
}

// Public: only published courses, with content-type counts for the
// landing page showcase. No lesson data — just VIDEO/PDF/POST counts.
//
// Batched (spec #13): one query for all published courses' PUBLISHED
// content rows (course_id IN [...]) instead of one query per course.
router.get("/", async (req, res, next) => {
  try {
    const { data: coursesData, error: coursesError } = await supabase
      .from("courses")
      .select("*")
      .eq("is_published", true);
    assertNoError(coursesError, "Failed to load courses");
    const courses = rows(coursesData);

    const courseIds = courses.map((c) => c.id);
    const countsByCourse = new Map();
    if (courseIds.length > 0) {
      const { data: contentData, error: contentError } = await supabase
        .from("content")
        .select("course_id, type")
        .in("course_id", courseIds)
        .eq("status", "PUBLISHED");
      assertNoError(contentError, "Failed to load course content");
      for (const d of contentData || []) {
        const counts = countsByCourse.get(d.course_id) || { VIDEO: 0, PDF: 0, POST: 0 };
        counts[d.type] = (counts[d.type] || 0) + 1;
        countsByCourse.set(d.course_id, counts);
      }
    }

    const shaped = courses.map((course) => ({
      ...course,
      contentCounts: countsByCourse.get(course.id) || { VIDEO: 0, PDF: 0, POST: 0 },
    }));

    shaped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ courses: shaped });
  } catch (err) {
    next(err);
  }
});

// Admin: full list including unpublished, with a content item count.
// Batched (spec #13): one query for all courses' content rows instead
// of one COUNT query per course.
// Student: courses that are explicitly scheduled to start in the future and
// are included in the student's currently usable plan. Only published courses
// are eligible (accessService is the single source of truth for entitlement).
router.get("/upcoming", authenticate, async (req, res, next) => {
  try {
    const { getUpcomingCourseIds } = require("../../plans-subscription/backend/accessService");
    const upcomingCourseIds = Array.from(await getUpcomingCourseIds(req.user.id));
    if (upcomingCourseIds.length === 0) return res.json({ courses: [] });

    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .in("id", upcomingCourseIds)
      .eq("is_published", true)
      .not("start_at", "is", null)
      .gt("start_at", new Date().toISOString())
      .order("start_at", { ascending: true });
    assertNoError(error, "Failed to load upcoming courses");

    res.json({ courses: rows(data) });
  } catch (err) {
    next(err);
  }
});

router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: coursesData, error: coursesError } = await supabase.from("courses").select("*");
    assertNoError(coursesError, "Failed to load courses");
    const courses = rows(coursesData);

    const courseIds = courses.map((c) => c.id);
    const countByCourse = new Map();
    if (courseIds.length > 0) {
      const { data: contentData, error: contentError } = await supabase
        .from("content")
        .select("course_id")
        .in("course_id", courseIds);
      assertNoError(contentError, "Failed to count course content");
      for (const d of contentData || []) {
        countByCourse.set(d.course_id, (countByCourse.get(d.course_id) || 0) + 1);
      }
    }

    const shaped = courses.map((course) => ({ ...course, _count: { content: countByCourse.get(course.id) || 0 } }));
    shaped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ courses: shaped });
  } catch (err) {
    next(err);
  }
});

// https:// only (spec #23) — rejects http://, javascript:, data:, file: and
// any other scheme a plain zod .url() check would otherwise accept.
const httpsUrl = z
  .string()
  .url()
  .refine(isAllowedHttpsImageUrl, { message: "thumbnailUrl must use an approved HTTPS image origin." });

const courseSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  description: z.string().trim().min(1, "Description is required."),
  category: z.string().trim().optional(),
  thumbnailUrl: httpsUrl.optional().or(z.literal("")),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  isPublished: z.boolean().optional(),
});

// Admin-only. Uploads a thumbnail image and returns its permanent
// public URL for use as `thumbnailUrl` on POST/PATCH below. A separate
// endpoint (rather than bundling the file into the course create/update
// request) because course creation is still plain JSON and this needs
// multipart/form-data — same reasoning as the video/pdf/post upload
// flow in upload.routes.js, just scoped to thumbnails and its own
// public Storage bucket (see lib/storage.js THUMBNAIL_BUCKET).
//
// Not tied to a courseId: an admin can upload a thumbnail while
// creating a brand-new course, before any course row exists yet — the
// generated storage path is just `thumbnails/{randomId}{ext}`.
const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxSizeBytesFor("POST"), files: 1 },
});

router.post("/thumbnail", authenticate, requireAdmin, thumbnailUpload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const ext = safeExtension(req.file.originalname);
    if (!isExtensionAllowed("POST", ext)) {
      return res.status(400).json({ error: `File extension ${ext || "(none)"} is not allowed. Use JPG, PNG, or WEBP.` });
    }
    if (!isMimeAllowed("POST", req.file.mimetype)) {
      return res.status(400).json({ error: `File type ${req.file.mimetype} is not allowed. Use JPG, PNG, or WEBP.` });
    }
    if (!matchesFileSignature("POST", req.file.buffer.subarray(0, 16))) {
      return res.status(415).json({ error: "File content does not match its declared type." });
    }

    const storagePath = `thumbnails/${crypto.randomUUID()}${ext}`;
    const thumbnailUrl = await uploadPublicImage(req.file.buffer, storagePath, req.file.mimetype);

    await logAction({
      actorId: req.user.id,
      action: "course.thumbnail_upload",
      entityType: "Course",
      metadata: { storagePath, fileSizeBytes: req.file.size },
    });

    res.status(201).json({ thumbnailUrl });
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    const maxMb = Math.round(maxSizeBytesFor("POST") / (1024 * 1024));
    return res.status(status).json({ error: err.code === "LIMIT_FILE_SIZE" ? `Thumbnail exceeds the ${maxMb}MB limit.` : err.message });
  }
  next(err);
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { title, description, category, thumbnailUrl, startAt, isPublished } = parsed.data;
    const created = await insertCourseWithUniqueSlug({
      title,
      description,
      category: category || null,
      thumbnailUrl: thumbnailUrl || null,
      startAt: startAt || null,
      isPublished: !!isPublished,
    });

    await logAction({ actorId: req.user.id, action: "course.create", entityType: "Course", entityId: created.id });
    res.status(201).json({ course: row(created) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = courseSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data, error } = await supabase
      .from("courses")
      .update(toSnake({ ...parsed.data, updatedAt: new Date() }))
      .eq("id", req.params.id)
      .select("*")
      .single();
    assertNoError(error, "Failed to update course");

    await logAction({ actorId: req.user.id, action: "course.update", entityType: "Course", entityId: req.params.id, metadata: parsed.data });
    res.json({ course: row(data) });
  } catch (err) {
    next(err);
  }
});

// Course deletion (spec #9): the DB-side work (detaching this course
// from plan.course_ids, deleting content rows via cascade, deleting the
// course row, and durably recording every file that now needs Storage
// cleanup) all happens inside delete_course_cascade() — a single
// Postgres transaction (see supabase/schema.sql) — so a failure partway
// through leaves the database exactly as it was, never "course gone,
// content still there" or "content gone, files still queued to keep".
//
// Storage deletion itself can't join that transaction (it's a separate
// HTTP-backed service), so instead the DB function queues every file in
// storage_cleanup_queue *before* returning success, and this route then
// makes a best-effort attempt to delete each one immediately and mark
// its queue row DONE/FAILED. Anything not cleaned up here (a Storage
// outage, a mid-request crash) simply stays PENDING/FAILED in the queue
// and is retried by the scheduled job in
// jobs/storageCleanupRetryJob.js — so the operation as a whole is
// recoverable and safe to retry, and repeated retries are idempotent
// (deleting an already-deleted object is not an error; see
// lib/storage.js deleteFileSafely).
router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: queued, error: rpcError } = await supabase.rpc("delete_course_cascade", {
      p_course_id: req.params.id,
    });
    if (rpcError && rpcError.code === "P0002") {
      return res.status(404).json({ error: "Course not found." });
    }
    assertNoError(rpcError, "Failed to delete course");

    const files = rows(queued);
    let cleanedUp = 0;
    let stillPending = 0;
    await Promise.all(
      files.map(async (f) => {
        const result = await deleteFileSafely(f.fileKey);
        if (result.ok) {
          cleanedUp += 1;
          await supabase
            .from("storage_cleanup_queue")
            .update({ status: "DONE", updated_at: new Date() })
            .eq("id", f.queueId);
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
      action: "course.delete",
      entityType: "Course",
      entityId: req.params.id,
      metadata: { filesQueued: files.length, filesCleanedUpImmediately: cleanedUp, filesPendingRetry: stillPending },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.insertCourseWithUniqueSlug = insertCourseWithUniqueSlug;
module.exports.slugify = slugify;
