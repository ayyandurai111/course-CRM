const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Loads courses.routes.js with a faked `../lib/db` supabase client, so
 * insertCourseWithUniqueSlug's insert-and-retry-on-conflict behavior is
 * directly testable without a live database. Mirrors the fake-module
 * pattern used in coursePublicationAccessControl.test.js.
 */
function loadCoursesRoutesWithFakeDb({ existingSlugs = [] } = {}) {
  const dbPath = require.resolve("../lib/db");
  const coursesRoutesPath = require.resolve("../routes/courses.routes");

  const taken = new Set(existingSlugs);
  const insertedSlugs = [];

  const fakeDb = {
    supabase: {
      from(table) {
        if (table !== "courses") throw new Error(`unexpected table ${table}`);
        return {
          insert(payload) {
            const slug = payload.slug;
            insertedSlugs.push(slug);
            return {
              select() {
                return this;
              },
              async single() {
                if (taken.has(slug)) {
                  return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "courses_slug_key"` } };
                }
                taken.add(slug);
                return { data: { id: `course-${insertedSlugs.length}`, ...payload }, error: null };
              },
            };
          },
        };
      },
    },
    row: (r) => r,
    rows: (data) => data || [],
    toSnake: (obj) => obj,
    assertNoError: (error) => {
      if (error) throw new Error("unexpected db error");
    },
  };

  [dbPath, coursesRoutesPath].forEach((p) => { if (p) delete require.cache[p]; });
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

  const routes = require("../routes/courses.routes");
  return { routes, insertedSlugs, taken };
}

test("no collision: uses the plain slugified title on the first attempt", async () => {
  const { routes, insertedSlugs } = loadCoursesRoutesWithFakeDb();
  const created = await routes.insertCourseWithUniqueSlug({ title: "React Bootcamp", description: "d" });
  assert.equal(created.slug, "react-bootcamp");
  assert.deepEqual(insertedSlugs, ["react-bootcamp"]);
});

test("race condition: a slug taken between check and insert is retried with a numeric suffix, not surfaced as a raw error", async () => {
  // Simulates the exact race: by the time THIS request's insert runs,
  // another concurrent request has already taken the base slug.
  const { routes, insertedSlugs } = loadCoursesRoutesWithFakeDb({ existingSlugs: ["react-bootcamp"] });
  const created = await routes.insertCourseWithUniqueSlug({ title: "React Bootcamp", description: "d" });
  assert.equal(created.slug, "react-bootcamp-1");
  // Must have actually attempted the base slug first (and failed) rather
  // than pre-checking and guessing — the insert IS the check.
  assert.deepEqual(insertedSlugs, ["react-bootcamp", "react-bootcamp-1"]);
});

test("multiple collisions in a row are all retried in sequence", async () => {
  const { routes, insertedSlugs } = loadCoursesRoutesWithFakeDb({
    existingSlugs: ["react-bootcamp", "react-bootcamp-1", "react-bootcamp-2"],
  });
  const created = await routes.insertCourseWithUniqueSlug({ title: "React Bootcamp", description: "d" });
  assert.equal(created.slug, "react-bootcamp-3");
  assert.deepEqual(insertedSlugs, ["react-bootcamp", "react-bootcamp-1", "react-bootcamp-2", "react-bootcamp-3"]);
});

test("giving up after too many collisions raises a clean 409, not a raw Postgres error", async () => {
  // Every slug this function could possibly try within its attempt
  // budget is already taken.
  const existingSlugs = Array.from({ length: 15 }, (_, i) => (i === 0 ? "react-bootcamp" : `react-bootcamp-${i}`));
  const { routes } = loadCoursesRoutesWithFakeDb({ existingSlugs });
  await assert.rejects(
    () => routes.insertCourseWithUniqueSlug({ title: "React Bootcamp", description: "d" }),
    (err) => {
      assert.equal(err.status, 409);
      assert.doesNotMatch(err.message, /courses_slug_key/);
      return true;
    }
  );
});

test("a non-slug database error is not swallowed or retried", async () => {
  const dbPath = require.resolve("../lib/db");
  const coursesRoutesPath = require.resolve("../routes/courses.routes");
  const fakeDb = {
    supabase: {
      from() {
        return {
          insert() {
            return {
              select() {
                return this;
              },
              async single() {
                return { data: null, error: { code: "23502", message: "null value in column violates not-null constraint" } };
              },
            };
          },
        };
      },
    },
    row: (r) => r,
    rows: (data) => data || [],
    toSnake: (obj) => obj,
    assertNoError: (error) => {
      if (error) throw new Error("unexpected db error");
    },
  };
  [dbPath, coursesRoutesPath].forEach((p) => { if (p) delete require.cache[p]; });
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };
  const routes = require("../routes/courses.routes");

  await assert.rejects(
    () => routes.insertCourseWithUniqueSlug({ title: "React Bootcamp", description: "d" }),
    /not-null constraint/
  );
});
