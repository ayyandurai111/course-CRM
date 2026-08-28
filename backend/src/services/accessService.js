const { supabase, rows, assertNoError } = require("../lib/db");
const { getCurrentSubscription } = require("./subscriptionService");

/**
 * Returns the set of courseIds a user currently has access to, based on
 * their ACTIVE, non-expired subscription (spec #7B: this is now the one
 * place — shared with /api/me/plan via subscriptionService — that
 * decides "is this subscription usable", instead of re-implementing the
 * expiry check separately). Plans embed their unlocked courseIds
 * directly (course_ids array column — see supabase/schema.sql), so this
 * is one query for the subscription + one batched read of its plan.
 */
/**
 * Returns the set of courseIds a user currently has access to, based on
 * their ACTIVE, non-expired subscription (spec #7B: this is now the one
 * place — shared with /api/me/plan via subscriptionService — that
 * decides "is this subscription usable", instead of re-implementing the
 * expiry check separately). Plans embed their unlocked courseIds
 * directly (course_ids array column — see supabase/schema.sql), so this
 * is one query for the subscription + one batched read of its plan.
 *
 * Spec fix — "enforce course publication during content access": a
 * plan's course_ids can still reference a course an admin has since
 * unpublished (e.g. taken down for edits) — a plan is not automatically
 * kept in sync with course.isPublished. This is the single place that
 * decides "is this course actually accessible right now", so it also
 * excludes any course whose isPublished is not true, in the same query
 * that reads the courses. Every access path (the content feed, upcoming
 * content, per-item access checks used by both /progress and signed
 * URL generation in files.routes.js) all call into this function or
 * userCanAccessCourse/userCanAccessContent below, so fixing it here
 * closes the gap everywhere at once rather than needing a
 * course.isPublished check duplicated at every call site.
 */
async function getAccessibleCourseIds(userId) {
  const { courseIds } = await getPlanLinkedPublishedCourses(userId, { dateFilter: "excludeFuture" });
  return courseIds;
}

/**
 * Shared by getAccessibleCourseIds (content access — excludes future
 * courses), getUpcomingCourseIds (the Upcoming Courses feed — ONLY
 * future courses), and userCanAccessCourseForLiveMeeting (meetings —
 * NO date gate at all, i.e. every plan-linked published course
 * regardless of start_at). All three need the same base set: courses
 * linked to the user's active plan that are also currently published —
 * they only differ on whether/how the start date further narrows it.
 *
 * `dateFilter`:
 *   - "excludeFuture": drop courses whose start_at is still in the future
 *   - "onlyFuture": keep ONLY courses whose start_at is in the future
 *   - "any": no date filtering at all — every plan-linked published course
 *
 * Bug history: this used to take a boolean `excludeFuture` where `false`
 * meant "only future" (used for the Upcoming Courses feed) rather than
 * "no filter" — there was no way to express "ignore the date gate
 * entirely". userCanAccessCourseForLiveMeeting was passing
 * `excludeFuture: false` intending "no gate", but actually got the
 * "only future" behavior, so a live meeting for any course that had
 * ALREADY started (the overwhelmingly common case) was wrongly
 * inaccessible to enrolled students — see
 * coursePublicationAccessControl.test.js for regression coverage.
 */
async function getPlanLinkedPublishedCourses(userId, { dateFilter }) {
  const { subscription, usable } = await getCurrentSubscription(userId);
  const courseIds = new Set();
  if (!usable) return { courseIds };

  const planIds = [subscription.planId];

  const { data: plansData, error: plansError } = await supabase
    .from("plans")
    .select("*")
    .in("id", planIds);
  assertNoError(plansError, "Failed to load plans");

  // A missing OR inactive plan must never grant access (spec #11): an
  // admin deactivating/deleting a plan should immediately revoke access
  // to every course it unlocked, even for students whose subscription
  // is still ACTIVE. Plans not returned by the `in` query above (i.e.
  // deleted) are simply absent here, so they contribute nothing.
  const candidateCourseIds = new Set();
  for (const plan of rows(plansData)) {
    if (plan.isActive !== true) continue;
    for (const courseId of plan.courseIds || []) candidateCourseIds.add(courseId);
  }
  if (candidateCourseIds.size === 0) return { courseIds };

  // Only actually-published courses grant access, regardless of what a
  // plan still references — see doc comment above.
  const { data: coursesData, error: coursesError } = await supabase
    .from("courses")
    .select("id, is_published, start_at")
    .in("id", [...candidateCourseIds])
    .eq("is_published", true);
  assertNoError(coursesError, "Failed to load courses");

  // A future course is visible in the dedicated Upcoming Courses feed but
  // must not grant lesson/content access before its scheduled start.
  // Courses without a start_at remain immediately accessible (and never
  // count as "upcoming").
  const now = Date.now();
  for (const course of rows(coursesData)) {
    const isFuture = !!course.startAt && new Date(course.startAt).getTime() > now;
    if (dateFilter === "excludeFuture" && isFuture) continue;
    if (dateFilter === "onlyFuture" && !isFuture) continue;
    courseIds.add(course.id);
  }

  return { courseIds };
}

async function getUpcomingCourseIds(userId) {
  const { courseIds } = await getPlanLinkedPublishedCourses(userId, { dateFilter: "onlyFuture" });
  return courseIds;
}

async function userCanAccessCourse(userId, courseId) {
  const ids = await getAccessibleCourseIds(userId);
  return ids.has(courseId);
}

/**
 * Bug fix — live meetings for a course whose `start_at` is still in the
 * future were unjoinable by any enrolled student: userCanAccessCourse()
 * (via getAccessibleCourseIds/excludeFuture) deliberately hides
 * not-yet-started courses from lesson/content access, but an admin can
 * legitimately start a LIVE meeting for such a course (e.g. a live
 * kickoff/orientation class held before the course's own content
 * unlocks). Meetings must only check "is this course published and
 * covered by an active plan" — NOT the future-start-date gate that
 * exists purely to hide pre-release lesson content. Uses
 * getPlanLinkedPublishedCourses(userId, { dateFilter: "any" }) — every
 * plan-linked, published course, regardless of start_at — which is the
 * union of the "excludeFuture" set (content access) and the
 * "onlyFuture" set (Upcoming Courses feed).
 */
async function userCanAccessCourseForLiveMeeting(userId, courseId) {
  const { courseIds } = await getPlanLinkedPublishedCourses(userId, { dateFilter: "any" });
  return courseIds.has(courseId);
}

/**
 * A content item is visible to a student only if:
 *  - status is PUBLISHED (never DRAFT/SCHEDULED/UNPUBLISHED/ARCHIVED)
 *  - publishedAt is in the past
 *  - the parent course is itself published (enforced inside
 *    getAccessibleCourseIds/userCanAccessCourse above — see that
 *    function's doc comment) — a course being taken down must
 *    immediately hide every content item inside it, even ones that are
 *    individually still marked PUBLISHED and even via a direct content
 *    ID (this function is the single choke point used by both the
 *    /progress route and signed URL generation in files.routes.js, so
 *    there is no bypass path that skips it)
 *  - the student's active plan grants access to the parent course
 */
async function userCanAccessContent(userId, content) {
  if (content.status !== "PUBLISHED") return false;
  if (content.publishedAt && new Date(content.publishedAt) > new Date()) return false;
  return userCanAccessCourse(userId, content.courseId);
}

module.exports = { getAccessibleCourseIds, getUpcomingCourseIds, userCanAccessCourse, userCanAccessCourseForLiveMeeting, userCanAccessContent };
