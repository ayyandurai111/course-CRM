const express = require("express");
const { z } = require("zod");
const { supabase, row, rows, assertNoError } = require("../lib/db");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { logAction } = require("../services/auditService");
const { getCurrentSubscriptionsByUserIds } = require("../services/subscriptionService");
const { beginStudentDeletion } = require("../services/userDeletionService");
const { containsPattern } = require("../lib/searchFilter");
const { parseValidDate } = require("../lib/dateValidation");

const router = express.Router();

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parsePagination(query) {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  return { limit, cursor: typeof query.cursor === "string" ? query.cursor : null };
}

/** Loads a user and asserts it exists AND is a STUDENT — the guard required everywhere
 * a student-management endpoint touches an arbitrary :id, so an admin (or the last
 * remaining admin) can never be modified/suspended/deleted through these routes. */
async function loadStudentOrThrow(id) {
  const { data, error } = await supabase.from("users").select("*").eq("id", id).maybeSingle();
  assertNoError(error, "Failed to load student");
  if (!data) {
    const err = new Error("Student not found.");
    err.status = 404;
    throw err;
  }
  if (data.role !== "STUDENT") {
    const err = new Error("This account is not a student.");
    err.status = 403;
    throw err;
  }
  return row(data);
}

// GET /api/students — keyset-paginated on created_at (spec #12: don't
// load entire tables). Search (spec #12D) is now a DB-side `ilike`
// filter combined with the same keyset pagination, instead of an
// in-memory pass applied *after* slicing to `limit` — the old version
// could never find a match outside the current page. Per-student
// subscription/plan lookups are batched (spec #13): two queries total
// for the whole page instead of up to 2*N.
router.get("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { search } = req.query;
    const { limit, cursor } = parsePagination(req.query);

    let q = supabase
      .from("users")
      .select("*")
      .eq("role", "STUDENT")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (search) {
      const pattern = containsPattern(search);
      q = q.or(`name.ilike.${pattern},email.ilike.${pattern}`);
    }

    if (cursor) {
      const { data: cursorRow } = await supabase.from("users").select("created_at").eq("id", cursor).maybeSingle();
      if (cursorRow) q = q.lt("created_at", cursorRow.created_at);
    }

    const { data, error } = await q;
    assertNoError(error, "Failed to load students");
    const students = rows(data).slice(0, limit);
    const nextCursor = data && data.length > limit ? students[students.length - 1].id : null;

    const studentIds = students.map((s) => s.id);
    const subsByUser = await getCurrentSubscriptionsByUserIds(studentIds);
    const planIds = [...new Set([...subsByUser.values()].map((v) => v.subscription.planId))];
    let plansById = new Map();
    if (planIds.length > 0) {
      const { data: plansData, error: plansError } = await supabase.from("plans").select("id, name").in("id", planIds);
      assertNoError(plansError, "Failed to load plans");
      plansById = new Map(rows(plansData).map((p) => [p.id, p]));
    }

    const shaped = students.map((student) => {
      const entry = subsByUser.get(student.id);
      if (!entry) return { ...student, subscriptions: [] };
      const plan = plansById.get(entry.subscription.planId);
      return { ...student, subscriptions: plan ? [{ plan }] : [] };
    });

    res.json({ students: shaped, nextCursor });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    assertNoError(userError, "Failed to load student");
    if (!userData) return res.status(404).json({ error: "Student not found." });

    const [{ data: subsData, error: subsError }, { data: progressData, error: progressError }] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("user_id", req.params.id),
      supabase.from("content_progress").select("*").eq("user_id", req.params.id),
    ]);
    assertNoError(subsError, "Failed to load subscriptions");
    assertNoError(progressError, "Failed to load progress");

    const subscriptions = await (async () => {
      const subs = rows(subsData);
      const planIds = [...new Set(subs.map((s) => s.planId))];
      let plansById = new Map();
      if (planIds.length > 0) {
        const { data: plansData, error: plansErr } = await supabase.from("plans").select("*").in("id", planIds);
        assertNoError(plansErr, "Failed to load plans");
        plansById = new Map(rows(plansData).map((p) => [p.id, p]));
      }
      return subs.map((sub) => ({ ...sub, plan: plansById.get(sub.planId) || null }));
    })();

    res.json({
      student: {
        id: userData.id,
        ...row(userData),
        subscriptions,
        progress: rows(progressData),
      },
    });
  } catch (err) {
    next(err);
  }
});

const assignPlanSchema = z.object({
  planId: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

// Admin assigns/changes a student's plan. Every precondition from spec
// #12 is validated server-side, and the cancel-old/create-new step runs
// inside the assign_subscription() Postgres function (see
// supabase/schema.sql) — a single atomic transaction — so two
// concurrent assignment requests for the same student can never both
// succeed and leave more than one ACTIVE subscription (spec #13).
router.post("/:id/subscription", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = assignPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { planId, expiresAt } = parsed.data;
    // expiresAt already passed zod's .datetime() format check above, but
    // route the future-date comparison through the same shared helper
    // used everywhere else (spec fix — never compare a possibly-invalid
    // Date directly; see lib/dateValidation.js).
    if (expiresAt) {
      const parsedExpiry = parseValidDate(expiresAt);
      if (!parsedExpiry || parsedExpiry.getTime() <= Date.now()) {
        return res.status(400).json({ error: "expiresAt must be a valid date/time in the future." });
      }
    }

    const student = await loadStudentOrThrow(req.params.id);
    if (student.isActive === false) {
      return res.status(400).json({ error: "Cannot assign a plan to a suspended student." });
    }

    const { data: planData, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("id", planId)
      .maybeSingle();
    assertNoError(planError, "Failed to load plan");
    if (!planData) return res.status(404).json({ error: "Plan not found." });
    if (planData.is_active !== true) return res.status(400).json({ error: "This plan is not active." });

    const { data: newSubId, error: rpcError } = await supabase.rpc("assign_subscription", {
      p_student_id: student.id,
      p_plan_id: planId,
      p_expires_at: expiresAt || null,
    });
    // 23505 = Postgres unique_violation. The database is the final
    // authority on "one ACTIVE subscription per student" (see
    // subscriptions_one_active_per_user_idx + assign_subscription() in
    // supabase/schema.sql); if a concurrent request still manages to
    // collide, surface a controlled 409 instead of an unhandled 500.
    if (rpcError && rpcError.code === "23505") {
      return res.status(409).json({ error: "This student's subscription was just changed by another request. Please retry." });
    }
    assertNoError(rpcError, "Failed to assign subscription");

    await logAction({
      actorId: req.user.id,
      action: "subscription.assign",
      entityType: "Subscription",
      entityId: newSubId,
      metadata: { studentId: student.id, planId },
    });

    res.status(201).json({ subscriptionId: newSubId });
  } catch (err) {
    next(err);
  }
});

// Suspend / reactivate — flips isActive without deleting any data.
router.patch("/:id/status", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const schema = z.object({ isActive: z.boolean() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "isActive must be a boolean." });

    await loadStudentOrThrow(req.params.id);
    const { error } = await supabase
      .from("users")
      .update({ is_active: parsed.data.isActive })
      .eq("id", req.params.id);
    assertNoError(error, "Failed to update student status");

    // Also ban/unban the Supabase Auth account itself, so a suspended
    // student can't even complete sign-in. A far-future ban_duration is
    // the Supabase Auth equivalent of Firebase Auth's `disabled: true`;
    // 'none' clears the ban to reactivate.
    try {
      await supabase.auth.admin.updateUserById(req.params.id, {
        ban_duration: parsed.data.isActive ? "none" : "876000h", // ~100 years
      });
    } catch (err) {
      console.error("Failed to sync Supabase Auth banned state:", err);
    }

    await logAction({
      actorId: req.user.id,
      action: parsed.data.isActive ? "student.reactivate" : "student.suspend",
      entityType: "User",
      entityId: req.params.id,
    });
    res.json({ student: { id: req.params.id, isActive: parsed.data.isActive } });
  } catch (err) {
    next(err);
  }
});

// Permanently delete a student. Spec fix — "deleted user recreation":
// this used to delete the database profile row FIRST and the Supabase
// Auth account second; if the Auth deletion then failed, the (still
// live) Auth account could log back in and get_or_create_user_profile()
// would silently recreate a brand-new STUDENT profile for it. Deletion
// now goes through beginStudentDeletion() (services/userDeletionService.js),
// which marks the profile inactive/pending-deletion BEFORE attempting
// Auth deletion, so access is cut off immediately either way, and the
// profile can never be recreated — see that module's doc comment for
// the full ordering rationale. If the Auth deletion doesn't succeed
// immediately, it's retried by the scheduled job in
// jobs/userDeletionRetryJob.js until it does.
router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    await loadStudentOrThrow(req.params.id);

    const { immediatelyDeleted } = await beginStudentDeletion(req.params.id);

    await logAction({
      actorId: req.user.id,
      action: "student.delete",
      entityType: "User",
      entityId: req.params.id,
      metadata: { immediatelyDeleted },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
