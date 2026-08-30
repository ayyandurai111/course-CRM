-- Add persistent video resume position to content progress.
-- Safe to run multiple times.

ALTER TABLE public.content_progress
ADD COLUMN IF NOT EXISTS last_position_seconds numeric;
