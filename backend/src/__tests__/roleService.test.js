const test = require("node:test");
const assert = require("node:assert/strict");
const { RoleChangeError, assertRoleChangeRequestIsWellFormed } = require("../services/roleService");

test("accepts a well-formed promotion request", () => {
  assert.doesNotThrow(() =>
    assertRoleChangeRequestIsWellFormed({ actorId: "admin-1", targetId: "student-1", newRole: "ADMIN" })
  );
});

test("accepts a well-formed demotion request", () => {
  assert.doesNotThrow(() =>
    assertRoleChangeRequestIsWellFormed({ actorId: "admin-1", targetId: "admin-2", newRole: "STUDENT" })
  );
});

test("rejects an unsupported role value", () => {
  assert.throws(
    () => assertRoleChangeRequestIsWellFormed({ actorId: "admin-1", targetId: "student-1", newRole: "SUPERUSER" }),
    (err) => err instanceof RoleChangeError && err.status === 422
  );
});

test("rejects a missing target id", () => {
  assert.throws(
    () => assertRoleChangeRequestIsWellFormed({ actorId: "admin-1", targetId: "", newRole: "ADMIN" }),
    (err) => err instanceof RoleChangeError && err.status === 422
  );
});

test("rejects an admin changing their own role", () => {
  assert.throws(
    () => assertRoleChangeRequestIsWellFormed({ actorId: "admin-1", targetId: "admin-1", newRole: "STUDENT" }),
    (err) => err instanceof RoleChangeError && err.status === 403
  );
});

test("self-promotion attempt (actor === target) is rejected regardless of direction", () => {
  assert.throws(
    () => assertRoleChangeRequestIsWellFormed({ actorId: "user-1", targetId: "user-1", newRole: "ADMIN" }),
    (err) => err instanceof RoleChangeError && err.status === 403
  );
});
