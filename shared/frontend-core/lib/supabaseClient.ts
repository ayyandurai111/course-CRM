import { createClient } from "@supabase/supabase-js";

// These come from Vite env vars (frontend/.env) — the URL and anon key
// are the public web config values and are safe to ship to the
// browser; they are not secrets. Real access control happens
// server-side via the backend's service-role Supabase client and
// Postgres Row Level Security (see supabase/schema.sql), not by hiding
// these values.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
