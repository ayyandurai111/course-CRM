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
async function getAccessibleCourseIds(userId) {
  const { subscription, usable } = await getCurrentSubscription(userId);
  const courseIds = new Set();
  if (!usable) return courseIds;

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
  for (const plan of rows(plansData)) {
    if (plan.isActive !== true) continue;
    for (const courseId of plan.courseIds || []) courseIds.add(courseId);
  }
  return courseIds;
}

async function userCanAccessCourse(userId, courseId) {
  const ids = await getAccessibleCourseIds(userId);
  return ids.has(courseId);
}

/**
 * A content item is visible to a student only if:
 *  - status is PUBLISHED (never DRAFT/SCHEDULED/UNPUBLISHED/ARCHIVED)
 *  - publishedAt is in the past
 *  - the student's active plan grants access to the parent course
 */
async function userCanAccessContent(userId, content) {
  if (content.status !== "PUBLISHED") return false;
  if (content.publishedAt && new Date(content.publishedAt) > new Date()) return false;
  return userCanAccessCourse(userId, content.courseId);
}

module.exports = { getAccessibleCourseIds, userCanAccessCourse, userCanAccessContent };
