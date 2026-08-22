const VALID_ROLES = ["STUDENT", "ADMIN"];

class RoleChangeError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "RoleChangeError";
    this.status = status;
  }
}

/**
 * Cheap, DB-independent checks that can be rejected before ever touching
 * Postgres. This is a first line of defense only — the authoritative,
 * race-safe checks (actor is really an active admin, target really
 * exists, the last-admin rule) live in the change_user_role() Postgres
 * function (see supabase/schema.sql) and run again regardless of what
 * happens here, since a direct RPC caller must be bound by the same
 * rules as this HTTP route.
 *
 * @param {{actorId: string, targetId: string, newRole: string}} input
 * @throws {RoleChangeError}
 */
function assertRoleChangeRequestIsWellFormed({ actorId, targetId, newRole }) {
  if (!VALID_ROLES.includes(newRole)) {
    throw new RoleChangeError(
      `role must be one of: ${VALID_ROLES.join(", ")}.`,
      422
    );
  }
  if (!targetId) {
    throw new RoleChangeError("A target user id is required.", 422);
  }
  if (actorId && actorId === targetId) {
    // Mirrors spec: a user must never be able to change their own role.
    // (For a STUDENT this is already unreachable — requireAdmin blocks
    // them from this route entirely — but an ADMIN targeting themselves
    // is a real request this route can receive, so it's checked here too.)
    throw new RoleChangeError("You cannot change your own role.", 403);
  }
}

module.exports = { VALID_ROLES, RoleChangeError, assertRoleChangeRequestIsWellFormed };
