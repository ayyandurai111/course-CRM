const { supabase } = require("./supabase");

/**
 * The Postgres schema uses snake_case columns (Postgres convention);
 * the rest of the app (and the frontend's TypeScript types) uses
 * camelCase, same as the old Firestore documents did. These two small
 * helpers convert at the boundary so route handlers stay close to
 * their original shape.
 */
function toCamelKey(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}
function toSnakeKey(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Shallow key-conversion — every table in this app is a flat row (arrays/jsonb values pass through untouched). */
function toCamel(obj) {
  if (obj === null || obj === undefined) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toCamelKey(k)] = v;
  return out;
}
function toSnake(obj) {
  if (obj === null || obj === undefined) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue; // never send `undefined` to PostgREST
    out[toSnakeKey(k)] = v;
  }
  return out;
}

/** Maps an array of DB rows to camelCase; safe on null/undefined. */
function rows(data) {
  return (data || []).map(toCamel);
}
/** Maps a single DB row to camelCase; safe on null/undefined. */
function row(data) {
  return data ? toCamel(data) : null;
}

/** Throws if a Supabase/PostgREST call returned an error — call after every query. */
function assertNoError(error, context) {
  if (error) {
    const err = new Error(`${context}: ${error.message}`);
    err.cause = error;
    throw err;
  }
}

/**
 * Dates already come back from PostgREST as ISO 8601 strings (unlike
 * Firestore Timestamps, which needed `.toDate().toISOString()`), so
 * this is now a no-op. Kept so route files that imported
 * `serializeDates` from "../lib/firestore" only need an import-path
 * change, not a call-site rewrite.
 */
function serializeDates(obj) {
  return obj;
}

module.exports = { supabase, toCamel, toSnake, rows, row, assertNoError, serializeDates };
