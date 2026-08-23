const test = require("node:test");
const assert = require("node:assert/strict");

function loadAccessServiceWithFakes({ usable, planId = "plan-1", plans = [], courses = [] }) {
  const dbPath = require.resolve("../lib/db");
  const subServicePath = require.resolve("../services/subscriptionService");
  const accessServicePath = require.resolve("../services/accessService");

  const fakeDb = {
    supabase: {
      from(table) {
        if (table === "plans") {
          return {
            select() {
              return this;
            },
            in(_col, ids) {
              this._ids = ids;
              return Promise.resolve({ data: plans.filter((p) => ids.includes(p.id)), error: null });
            },
          };
        }
        if (table === "courses") {
          return {
            select() {
              return this;
            },
            in(_col, ids) {
              this._ids = ids;
              return this;
            },
            eq(col, val) {
              const filtered = courses.filter((c) => this._ids.includes(c.id) && c[col] === val);
              return Promise.resolve({ data: filtered, error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
    rows: (data) => (data || []).map((r) => ({ ...r, courseIds: r.course_ids || r.courseIds, isActive: r.is_active ?? r.isActive })),
    row: (r) => r,
    assertNoError: (error) => {
      if (error) throw new Error("unexpected db error");
    },
  };

  const fakeSubService = {
    getCurrentSubscription: async () => ({ subscription: { planId }, usable }),
  };

  [dbPath, subServicePath, accessServicePath].forEach((p) => delete require.cache[p]);
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  require.cache[subServicePath] = { id: subServicePath, filename: subServicePath, loaded: true, exports: fakeSubService };

  return require("../services/accessService");
}

// --- the core bug: plan references a course that's since been unpublished ---

test("published course + published content + subscribed student: access granted", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-a"] }],
    courses: [{ id: "course-a", is_published: true }],
  });
  const ids = await access.getAccessibleCourseIds("student-1");
  assert.ok(ids.has("course-a"));

  const content = { id: "content-1", courseId: "course-a", type: "VIDEO", status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000) };
  assert.equal(await access.userCanAccessContent("student-1", content), true);
});

test("unpublished course + published content + subscribed student: access DENIED (the fix)", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-b"] }],
    courses: [{ id: "course-b", is_published: false }], // taken down, but plan still references it
  });
  const ids = await access.getAccessibleCourseIds("student-1");
  assert.equal(ids.has("course-b"), false);

  const content = { id: "content-2", courseId: "course-b", type: "VIDEO", status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000) };
  assert.equal(await access.userCanAccessContent("student-1", content), false);
});

test("published course + unpublished (DRAFT) content: access denied on the content check alone", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-c"] }],
    courses: [{ id: "course-c", is_published: true }],
  });
  const content = { id: "content-3", courseId: "course-c", type: "VIDEO", status: "DRAFT", publishedAt: null };
  assert.equal(await access.userCanAccessContent("student-1", content), false);
});

test("unsubscribed student: no access regardless of course/content publication state", async () => {
  const access = loadAccessServiceWithFakes({
    usable: false,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-a"] }],
    courses: [{ id: "course-a", is_published: true }],
  });
  const ids = await access.getAccessibleCourseIds("student-1");
  assert.equal(ids.size, 0);

  const content = { id: "content-1", courseId: "course-a", type: "VIDEO", status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000) };
  assert.equal(await access.userCanAccessContent("student-1", content), false);
});

test("direct content-ID access to an unpublished course cannot be bypassed by calling userCanAccessContent directly (no course-list step)", async () => {
  // Mirrors what files.routes.js / the /progress route do: look up the
  // single content row by id, then ask userCanAccessContent — never
  // going through a pre-filtered "list of accessible content" first.
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-hidden"] }],
    courses: [{ id: "course-hidden", is_published: false }],
  });
  const content = { id: "content-secret", courseId: "course-hidden", type: "PDF", status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000) };
  assert.equal(await access.userCanAccessContent("student-1", content), false);
});

test("a course not referenced by any active plan grants no access even if published", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-other"] }],
    courses: [{ id: "course-other", is_published: true }, { id: "course-z", is_published: true }],
  });
  const ids = await access.getAccessibleCourseIds("student-1");
  assert.equal(ids.has("course-z"), false);
});
