-- SM-2 Spaced Repetition columns for memory_atoms
-- Run this in the Supabase SQL Editor if not applied automatically.

ALTER TABLE public.memory_atoms
ADD COLUMN IF NOT EXISTS sm2_ef REAL DEFAULT 2.5,
ADD COLUMN IF NOT EXISTS sm2_interval INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS sm2_repetitions INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS sm2_next_review_date TIMESTAMPTZ;

-- Index for fast retrieval of due-for-review atoms
CREATE INDEX IF NOT EXISTS idx_memory_atoms_sm2_review
  ON public.memory_atoms(student_id, sm2_next_review_date)
  WHERE sm2_next_review_date IS NOT NULL;

COMMENT ON COLUMN public.memory_atoms.sm2_ef IS 'SM-2 Easiness Factor (default 2.5, min 1.3)';
COMMENT ON COLUMN public.memory_atoms.sm2_interval IS 'SM-2 inter-repetition interval in days';
COMMENT ON COLUMN public.memory_atoms.sm2_repetitions IS 'SM-2 consecutive correct repetitions count';
COMMENT ON COLUMN public.memory_atoms.sm2_next_review_date IS 'Next scheduled review date computed by SM-2';
