-- Misconceptions picked up in tutoring chats are stored as mistake_patterns
-- with category 'misconception'. resolved_at marks when the student later
-- showed correct understanding, so the tutor stops re-addressing it.
ALTER TABLE public.mistake_patterns
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS mistake_active_idx
  ON public.mistake_patterns(student_id, last_seen DESC)
  WHERE resolved_at IS NULL;
