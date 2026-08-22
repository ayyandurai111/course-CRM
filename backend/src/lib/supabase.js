const { createClient } = require("@supabase/supabase-js");

// The backend ALWAYS uses the service role key — it bypasses Row Level
// Security (see supabase/schema.sql) the same way the old Firebase
// Admin SDK bypassed firestore.rules/storage.rules. This key must never
// be sent to the frontend; only VITE_SUPABASE_ANON_KEY goes there.
//
// The client is created lazily (on first real use) rather than at
// import time. Several files that only need pure helper functions from
// contentService/fileValidation transitively require this module; a
// unit-test run (or any script) that never actually talks to Supabase
// shouldn't be forced to set real credentials just to import them.
let _client = null;

function getClient() {
  if (_client) return _client;

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see backend/.env.example)."
    );
  }

  _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _client;
}

// A Proxy so existing call sites (`supabase.from(...)`, `supabase.auth...`,
// `supabase.storage...`, `supabase.rpc(...)`) keep working unchanged —
// the real client (and its credential check) is only constructed the
// first time a property is actually accessed.
const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      return getClient()[prop];
    },
  }
);

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "course-files";

module.exports = { supabase, STORAGE_BUCKET };
