const express = require("express");
const { isAllowedHttpsImageUrl } = require("../lib/urlSecurity");
const { z } = require("zod");
const { supabase, row, toSnake, assertNoError } = require("../lib/db");
const { authenticate } = require("../middleware/auth");
const { logAction } = require("../services/auditService");
const { isValidBootstrapToken } = require("../lib/bootstrapToken");

const router = express.Router();

// Sign-up and sign-in themselves happen entirely on the client via the
// Supabase Auth SDK (Google OAuth or email/password). This endpoint just
// upserts the `users` profile row right after the client gets its
// session, so name/photo from Google are captured on first login.
// Calling it is optional — authenticate() will auto-create a bare
// profile on the first authenticated request anyway — but calling it
// right after login gets the freshest name/photo from the Google account.
const syncSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  avatarUrl: z
    .string()
    .url()
    .refine(isAllowedHttpsImageUrl, { message: "avatarUrl must use an approved HTTPS image origin." })
    .optional(),
});

router.post("/sync", authenticate, async (req, res, next) => {
  try {
    const parsed = syncSchema.safeParse(req.body);
    const updates = parsed.success ? parsed.data : {};
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from("users").update(toSnake(updates)).eq("id", req.user.id);
      assertNoError(error, "Failed to sync user profile");
    }
    const { data, error } = await supabase.from("users").select("*").eq("id", req.user.id).single();
    assertNoError(error, "Failed to load user profile");
    res.json({ user: row(data) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// ---------------------------------------------------------------------
// POST /api/auth/bootstrap-admin — secure, one-time admin bootstrap.
// See bootstrap_first_admin() in supabase/schema.sql for the full
// security rationale. In short: this route is a thin wrapper around
// that DB function, and every actual security decision (email match,
// "only while zero admins exist", concurrency-safety) is enforced
// there, not here — this route only adds the operator-controlled
// on/off switch (ADMIN_BOOTSTRAP_TOKEN) and translates the result into
// an HTTP response. Never exposes or accepts a service-role key, and
// never trusts anything about role from the request body.
// ---------------------------------------------------------------------
router.post("/bootstrap-admin", authenticate, async (req, res, next) => {
  try {
    const configuredToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    if (!configuredToken) {
      // Feature is off unless an operator explicitly set a token; 404
      // (not 403) so the endpoint's existence isn't revealed once the
      // operator unsets the token again after bootstrapping.
      return res.status(404).json({ error: "Not found." });
    }

    const suppliedToken = req.headers["x-bootstrap-token"];
    if (!isValidBootstrapToken(suppliedToken, configuredToken)) {
      return res.status(403).json({ error: "Invalid bootstrap token." });
    }

    const { data, error } = await supabase.rpc("bootstrap_first_admin", {
      p_user_id: req.user.id,
      p_seed_admin_email: process.env.SEED_ADMIN_EMAIL || null,
    });
    if (error) {
      // These are all deliberate, client-safe messages raised inside
      // bootstrap_first_admin() itself (wrong email / already used /
      // not configured) — safe to surface directly, unlike a generic
      // DB failure.
      const err = new Error(error.message);
      err.status = 409;
      throw err;
    }

    await logAction({
      actorId: req.user.id,
      action: "ADMIN_BOOTSTRAPPED",
      entityType: "user",
      entityId: req.user.id,
      metadata: { email: req.user.email },
    });

    res.json({ user: row(data) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
