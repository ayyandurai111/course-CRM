const express = require("express");
const { z } = require("zod");
const { supabase, row, rows, assertNoError } = require("../lib/db");
const { authenticate, requireAdmin } = require("../middleware/auth");
const { logAction } = require("../services/auditService");
const { VALID_ROLES, RoleChangeError, assertRoleChangeRequestIsWellFormed } = require("../services/roleService");
const { containsPattern } = require("../lib/searchFilter");

const router = express.Router();
router.use(authenticate, requireAdmin);

async function countWhere(table, field, value) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(field, value);
  assertNoError(error, `Failed to count ${table}`);
  return count || 0;
}

router.get("/overview", async (req, res, next) => {
  try {
    const [studentCount, courseCount, publishedContent, scheduledContent, draftContent, activeSubs] =
      await Promise.all([
        countWhere("users", "role", "STUDENT"),
        supabase
          .from("courses")
          .select("*", { count: "exact", head: true })
          .then(({ count, error }) => {
            assertNoError(error, "Failed to count courses");
            return count || 0;
          }),
        countWhere("content", "status", "PUBLISHED"),
        countWhere("content", "status", "SCHEDULED"),
        countWhere("content", "status", "DRAFT"),
        countWhere("subscriptions", "status", "ACTIVE"),
      ]);

    res.json({ studentCount, courseCount, publishedContent, scheduledContent, draftContent, activeSubscriptions: activeSubs });
  } catch (err) {
    next(err);
  }
});

router.get("/audit-logs", async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    assertNoError(error, "Failed to load audit logs");

    const logs = rows(data);
    const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))];
    let actorsById = new Map();
    if (actorIds.length > 0) {
      const { data: actorsData, error: actorsError } = await supabase
        .from("users")
        .select("id, name, email")
        .in("id", actorIds);
      assertNoError(actorsError, "Failed to load audit log actors");
      actorsById = new Map(rows(actorsData).map((a) => [a.id, a]));
    }

    const shaped = logs.map((log) => ({
      ...log,
      actor: actorsById.get(log.actorId) || { name: "Unknown", email: "" },
    }));
    res.json({ logs: shaped });
  } catch (err) {
    next(err);
  }
});

const MAX_USERS_PAGE_SIZE = 50;

// GET /admin/users — search across all users (STUDENT + ADMIN) by
// name/email. Unlike GET /students (students.routes.js), this isn't
// filtered to role=STUDENT, since an admin needs to be able to find an
// existing ADMIN too (e.g. to demote them) as well as students to
// promote. Spec #12: search is a DB-side `ilike` filter (was an
// in-memory pass over an unconditional 200-row fetch) so the result is
// always bounded at the database, not just truncated after the fact.
router.get("/users", async (req, res, next) => {
  try {
    const { search } = req.query;
    let q = supabase.from("users").select("*").order("created_at", { ascending: false }).limit(MAX_USERS_PAGE_SIZE);
    if (search) {
      const pattern = containsPattern(search);
      q = q.or(`name.ilike.${pattern},email.ilike.${pattern}`);
    }
    const { data, error } = await q;
    assertNoError(error, "Failed to search users");
    res.json({ users: rows(data) });
  } catch (err) {
    next(err);
  }
});

const changeRoleSchema = z.object({
  role: z.enum(VALID_ROLES),
});

// POST /admin/users/:id/role — promote/demote a user between STUDENT
// and ADMIN. This is the one privileged operation that can create new
// admins after the initial bootstrap (see backend/scripts/promoteAdmin.js
// and README.md), so every business rule from the spec is enforced
// twice: cheaply here for a fast, clear 4xx, and authoritatively (and
// race-safely) inside change_user_role() in supabase/schema.sql, which
// is the actual source of truth. The actor is always req.user.id from
// the verified Supabase JWT — never a client-supplied value.
router.post("/users/:id/role", async (req, res, next) => {
  try {
    const parsed = changeRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: "role must be one of: " + VALID_ROLES.join(", ") + "." });
    }
    const { role: newRole } = parsed.data;
    const targetId = req.params.id;

    try {
      assertRoleChangeRequestIsWellFormed({ actorId: req.user.id, targetId, newRole });
    } catch (err) {
      if (err instanceof RoleChangeError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }

    const { data, error } = await supabase.rpc("change_user_role", {
      p_actor_id: req.user.id,
      p_target_id: targetId,
      p_new_role: newRole,
    });

    if (error) {
      // insufficient_privilege — either the actor isn't a valid active
      // admin anymore, an admin tried to change their own role via a
      // direct RPC call, or this would remove the last active admin.
      if (error.code === "42501") {
        return res.status(403).json({ error: error.message });
      }
      if (error.code === "22023") {
        return res.status(422).json({ error: error.message });
      }
      if (error.code === "P0002") {
        return res.status(404).json({ error: "Target user not found." });
      }
      assertNoError(error, "Failed to change user role");
    }

    const result = row(Array.isArray(data) ? data[0] : data);
    if (!result) return res.status(404).json({ error: "Target user not found." });

    if (result.oldRole !== result.newRole) {
      await logAction({
        actorId: req.user.id,
        action: "user.role_change",
        entityType: "User",
        entityId: targetId,
        metadata: { oldRole: result.oldRole, newRole: result.newRole },
      });
    }

    res.json({ user: { id: targetId, role: result.newRole } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
