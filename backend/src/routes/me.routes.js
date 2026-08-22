const express = require("express");
const { z } = require("zod");
const { supabase, row, rows, toSnake, assertNoError } = require("../lib/db");
const { authenticate } = require("../middleware/auth");
const { getCurrentSubscription } = require("../services/subscriptionService");

const router = express.Router();

// Spec #7: uses the same subscriptionService.getCurrentSubscription()
// used by course/content/file access checks, so this endpoint can never
// again report ACTIVE while access checks elsewhere report expired.
// `isUsable` (and `isExpired` for the common case that made those two
// disagree) are surfaced explicitly rather than silently changing the
// stored `status` — the frontend can show "expired" without this
// endpoint mutating a historical record it shouldn't own (spec #7D).
router.get("/plan", authenticate, async (req, res, next) => {
  try {
    const { subscription, usable } = await getCurrentSubscription(req.user.id);
    if (!subscription) return res.json({ subscription: null });

    const { data: planData, error: planError } = await supabase
      .from("plans")
      .select("*")
      .eq("id", subscription.planId)
      .maybeSingle();
    assertNoError(planError, "Failed to load plan");

    const isExpired = subscription.status === "ACTIVE" && !usable;
    res.json({
      subscription: { ...subscription, plan: row(planData), isUsable: usable, isExpired },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/progress", authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("content_progress")
      .select("*")
      .eq("user_id", req.user.id);
    assertNoError(error, "Failed to load progress");

    const items = rows(data);
    const total = items.length;
    const completed = items.filter((r) => r.viewed || r.progressPercent >= 100).length;
    const overallPercent = total === 0 ? 0 : Math.round((completed / total) * 100);

    res.json({ overallPercent, completed, total, items });
  } catch (err) {
    next(err);
  }
});

const httpsUrl = z
  .string()
  .url()
  .refine((v) => v.toLowerCase().startsWith("https://"), { message: "avatarUrl must use https://." });

const profileSchema = z.object({
  name: z.string().min(1).optional(),
  avatarUrl: httpsUrl.optional().or(z.literal("")),
});

router.patch("/profile", authenticate, async (req, res, next) => {
  try {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    const { error } = await supabase.from("users").update(toSnake(parsed.data)).eq("id", req.user.id);
    assertNoError(error, "Failed to update profile");

    const { data, error: fetchError } = await supabase.from("users").select("*").eq("id", req.user.id).single();
    assertNoError(fetchError, "Failed to load profile");
    res.json({ user: row(data) });
  } catch (err) {
    next(err);
  }
});

// Password changes are handled entirely client-side via the Supabase
// Auth SDK (updateUser / resetPasswordForEmail) — there's no server-side
// password hash for Supabase-authenticated accounts to check or update.

module.exports = router;
