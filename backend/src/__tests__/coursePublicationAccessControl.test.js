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
    rows: (data) => (data || []).map((r) => ({ ...r, courseIds: r.course_ids || r.courseIds, isActive: r.is_active ?? r.isActive, startAt: r.start_at ?? r.startAt })),
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

test("future-start course is visible only in upcoming feed and does not grant content access before start", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-future"] }],
    courses: [{ id: "course-future", is_published: true, start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }],
  });
  const ids = await access.getAccessibleCourseIds("student-1");
  assert.equal(ids.has("course-future"), false);

  const content = { id: "content-future", courseId: "course-future", type: "VIDEO", status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000) };
  assert.equal(await access.userCanAccessContent("student-1", content), false);
});

test("started course remains accessible when start_at is in the past", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-started"] }],
    courses: [{ id: "course-started", is_published: true, start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }],
  });
  const ids = await access.getAccessibleCourseIds("student-1");
  assert.equal(ids.has("course-started"), true);
});

// --- userCanAccessCourseForLiveMeeting: no date gate at all (regression
// for the "excludeFuture: false" bug — that accidentally meant "only
// future" rather than "no filter", so an already-started course's live
// meeting was wrongly unjoinable by enrolled students) ---

test("live meeting access: an ALREADY-STARTED course (the common case) is joinable", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-started"] }],
    courses: [{ id: "course-started", is_published: true, start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }],
  });
  assert.equal(await access.userCanAccessCourseForLiveMeeting("student-1", "course-started"), true);
});

test("live meeting access: a FUTURE course (e.g. a pre-release live kickoff) is joinable", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-future"] }],
    courses: [{ id: "course-future", is_published: true, start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() }],
  });
  assert.equal(await access.userCanAccessCourseForLiveMeeting("student-1", "course-future"), true);
});

test("live meeting access: a course with no start_at at all is joinable", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-no-date"] }],
    courses: [{ id: "course-no-date", is_published: true }],
  });
  assert.equal(await access.userCanAccessCourseForLiveMeeting("student-1", "course-no-date"), true);
});

test("live meeting access: an UNPUBLISHED course is still denied regardless of date", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-unpub"] }],
    courses: [{ id: "course-unpub", is_published: false }],
  });
  assert.equal(await access.userCanAccessCourseForLiveMeeting("student-1", "course-unpub"), false);
});

test("live meeting access: a course not linked to the user's active plan is denied", async () => {
  const access = loadAccessServiceWithFakes({
    usable: true,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-other"] }],
    courses: [{ id: "course-other", is_published: true }, { id: "course-z", is_published: true }],
  });
  assert.equal(await access.userCanAccessCourseForLiveMeeting("student-1", "course-z"), false);
});

test("live meeting access: an unsubscribed student is denied even for a started, published, plan-referenced course", async () => {
  const access = loadAccessServiceWithFakes({
    usable: false,
    plans: [{ id: "plan-1", is_active: true, course_ids: ["course-started"] }],
    courses: [{ id: "course-started", is_published: true, start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }],
  });
  assert.equal(await access.userCanAccessCourseForLiveMeeting("student-1", "course-started"), false);
});
