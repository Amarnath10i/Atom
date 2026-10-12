-- Learned student model (agents/student_model.py, trained and evaluated in ml/).
--
-- 1. Keep every graded answer. Until now a mock test was folded into one
--    accuracy figure per topic and the answers were dropped; the model reads
--    the answer sequence itself (right/wrong, difficulty, time, recency).
CREATE TABLE IF NOT EXISTS public.question_attempts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject       TEXT        NOT NULL,
  topic         TEXT        NOT NULL,
  exam_unit     TEXT,
  difficulty    SMALLINT    NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  correct       BOOLEAN     NOT NULL,
  time_sec      REAL        NOT NULL DEFAULT 0 CHECK (time_sec >= 0),
  source        TEXT        NOT NULL DEFAULT 'mock_test' CHECK (source IN ('mock_test', 'practice')),
  mock_test_id  UUID        REFERENCES public.mock_tests(id) ON DELETE SET NULL,
  answered_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS question_attempts_student_idx
  ON public.question_attempts(student_id, answered_at DESC);
GRANT ALL ON public.question_attempts TO service_role;
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;

-- 2. Say where each topic's mastery came from. 'model': the learned student
--    model's probability of a right answer, from graded answers. 'estimate':
--    the earlier rules and the chat extractor's judgement, kept for topics
--    that have only been discussed, never tested.
ALTER TABLE public.memory_atoms
  ADD COLUMN IF NOT EXISTS mastery_source TEXT NOT NULL DEFAULT 'estimate'
    CHECK (mastery_source IN ('estimate', 'model')),
  ADD COLUMN IF NOT EXISTS half_life_days REAL,
  ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ;
