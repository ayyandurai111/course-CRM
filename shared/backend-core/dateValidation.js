const { z } = require("zod");

/**
 * Spec fix — "Validate Scheduled Dates": `new Date("garbage")` does not
 * throw — it silently produces an Invalid Date object, and every
 * comparison against it (`<`, `<=`, `>`, `>=`) evaluates to `false`
 * rather than throwing or being obviously wrong. That is what let an
 * invalid `scheduledAt` slip straight past a naive
 * `if (new Date(scheduledAt) <= new Date())` "must be in the future"
 * check: an Invalid Date is never `<=` anything, so the check simply
 * never fires. Every place that accepts a date from a client (directly
 * or as part of a broader payload) must route through these helpers —
 * an explicit `Number.isNaN(date.getTime())` check — instead of
 * comparing a possibly-invalid Date directly.
 */
function isValidDate(date) {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

/**
 * Parses `value` into a genuinely valid Date, or returns null for
 * anything that isn't one — empty string, null/undefined, a garbage
 * string, or a Date that already is invalid. Never returns an Invalid
 * Date object for a caller to accidentally compare.
 */
function parseValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return isValidDate(date) ? date : null;
}

/**
 * zod schema: a required, non-empty string that parses to a genuinely
 * valid date/time (any format `Date` can parse, e.g. ISO 8601 with an
 * explicit UTC offset — the recommended, unambiguous format for a
 * scheduling API; see the "consistent timezone handling" note below).
 *
 * Timezone handling: this project always stores and compares dates as
 * absolute instants (`timestamptz` columns in Postgres, `Date` objects
 * in JS) — never "wall clock" local time — so clients should always
 * send a value with an explicit offset (a trailing `Z` for UTC, or
 * `+02:00` etc.). A bare `2026-01-01T00:00:00` with no offset is still
 * accepted (JS parses it as local time to the *server's* timezone),
 * but is not recommended for API clients since that makes the instant
 * it refers to depend on the server's configured timezone rather than
 * the client's intent.
 */
const isoDateTimeString = z
  .string()
  .min(1, "A date/time value is required.")
  .refine((v) => parseValidDate(v) !== null, { message: "Must be a valid date/time (ISO 8601, e.g. 2026-01-01T00:00:00Z)." });

/** isoDateTimeString that must also be strictly in the future at the moment it's validated. */
const futureIsoDateTimeString = isoDateTimeString.refine(
  (v) => {
    const parsed = parseValidDate(v);
    return parsed !== null && parsed.getTime() > Date.now();
  },
  { message: "Must be a date/time in the future." }
);

module.exports = { isValidDate, parseValidDate, isoDateTimeString, futureIsoDateTimeString };
