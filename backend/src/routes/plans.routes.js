const express = require("express");
const { z } = require("zod");
const { supabase, row, rows, toSnake, assertNoError } = require("../lib/db");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { logAction } = require("../services/auditService");

const router = express.Router();

async function attachCourses(plan) {
  const courseIds = plan.courseIds || [];
  if (courseIds.length === 0) return { ...plan, planCourses: [] };

  const { data, error } = await supabase.from("courses").select("id, title").in("id", courseIds);
  assertNoError(error, "Failed to load plan courses");
  const courses = rows(data);
  // Preserve order/duplicates from courseIds, same as the old Promise.all-of-doc-reads.
  const byId = new Map(courses.map((c) => [c.id, c]));
  const planCourses = courseIds.filter((id) => byId.has(id)).map((id) => ({ course: byId.get(id) }));
  return { ...plan, planCourses };
}

// Public: active plans only, for the landing page pricing section.
router.get("/", async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("plans").select("*").eq("is_active", true);
    assertNoError(error, "Failed to load plans");

    let plans = await Promise.all(rows(data).map(attachCourses));
    plans.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    res.json({ plans });
  } catch (err) {
    next(err);
  }
});

// Spec #13: one query for every plan's ACTIVE subscription count
// instead of one COUNT query per plan.
router.get("/admin", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("plans").select("*");
    assertNoError(error, "Failed to load plans");
    const plans = rows(data);

    const planIds = plans.map((p) => p.id);
    const countByPlan = new Map();
    if (planIds.length > 0) {
      const { data: subsData, error: subsError } = await supabase
        .from("subscriptions")
        .select("plan_id")
        .in("plan_id", planIds)
        .eq("status", "ACTIVE");
      assertNoError(subsError, "Failed to count plan subscriptions");
      for (const s of subsData || []) countByPlan.set(s.plan_id, (countByPlan.get(s.plan_id) || 0) + 1);
    }

    const shaped = plans.map((plan) => ({ ...plan, _count: { subscriptions: countByPlan.get(plan.id) || 0 } }));
    shaped.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    res.json({ plans: shaped });
  } catch (err) {
    next(err);
  }
});

const planSchema = z.object({
  name: z.string().min(1),
  priceCents: z.number().int().min(0),
  currency: z.string().min(1).max(6).optional(),
  billingPeriod: z.enum(["ONE_TIME", "MONTHLY", "YEARLY"]).optional(),
  description: z.string().optional(),
  features: z.array(z.string()).optional(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  courseIds: z.array(z.string()).optional(),
});

router.post("/", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const data = {
      currency: "INR",
      billingPeriod: "MONTHLY",
      features: [],
      isPopular: false,
      isActive: true,
      sortOrder: 0,
      courseIds: [],
      ...parsed.data,
    };
    const { data: created, error } = await supabase.from("plans").insert(toSnake(data)).select("*").single();
    assertNoError(error, "Failed to create plan");

    await logAction({ actorId: req.user.id, action: "plan.create", entityType: "Plan", entityId: created.id });
    res.status(201).json({ plan: row(created) });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const parsed = planSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { data, error } = await supabase
      .from("plans")
      .update(toSnake({ ...parsed.data, updatedAt: new Date() }))
      .eq("id", req.params.id)
      .select("*")
      .single();
    assertNoError(error, "Failed to update plan");

    await logAction({ actorId: req.user.id, action: "plan.update", entityType: "Plan", entityId: req.params.id, metadata: parsed.data });
    res.json({ plan: row(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * Pure — maps a Postgres delete error to the response this route should
 * send, so the FK-violation-to-409 translation is directly testable
 * without a live database. Returns null for "not a special case, let
 * assertNoError/the global handler deal with it".
 */
function mapPlanDeleteError(error) {
  if (error && error.code === "23503") {
    return {
      status: 409,
      body: {
        error: "This plan has subscription history and cannot be deleted. Deactivate it instead so it stops accepting new subscriptions.",
      },
    };
  }
  return null;
}

// A plan can never be truly deleted once any student has ever been
// subscribed to it — subscriptions.plan_id has a `references` FK with
// no ON DELETE clause (i.e. RESTRICT), by design: subscription history
// must never silently disappear or be reassigned out from under a
// student's billing/access record. Without catching this, the raw
// Postgres foreign-key-violation (23503) would surface to the client as
// an opaque 500. Deactivating (PATCH isActive: false) is the correct
// way to retire a plan that has ever had a subscriber; only a plan that
// was created by mistake and never subscribed to can be hard-deleted.
router.delete("/:id", authenticate, requireAdmin, async (req, res, next) => {
  try {
    const { error } = await supabase.from("plans").delete().eq("id", req.params.id);
    const mapped = mapPlanDeleteError(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    assertNoError(error, "Failed to delete plan");
    await logAction({ actorId: req.user.id, action: "plan.delete", entityType: "Plan", entityId: req.params.id });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.mapPlanDeleteError = mapPlanDeleteError;
