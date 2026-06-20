-- =========================================================
--  Learning OS v4 — Mistake patterns, Mock tests,
--                   Long-term learner model extensions
-- =========================================================

-- ─── Mistake patterns ────────────────────────────────────
-- Captures recurring conceptual errors per topic.
CREATE TABLE IF NOT EXISTS public.mistake_patterns (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject         TEXT        NOT NULL,
  topic           TEXT        NOT NULL,
  pattern         TEXT        NOT NULL,                   -- short label, e.g. "sign error in integration"
  description     TEXT        NOT NULL DEFAULT '',
  category        TEXT        NOT NULL DEFAULT 'conceptual'
                              CHECK (category IN ('conceptual','procedural','careless','misconception','prerequisite_gap')),
  occurrences     INT         NOT NULL DEFAULT 1,
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject, topic, pattern)
);
CREATE INDEX IF NOT EXISTS mistake_student_idx
  ON public.mistake_patterns(student_id, last_seen DESC);
GRANT ALL ON public.mistake_patterns TO service_role;
ALTER TABLE public.mistake_patterns ENABLE ROW LEVEL SECURITY;

-- ─── Mock tests ──────────────────────────────────────────
-- Full-length / sectional mock test outcome tracking.
CREATE TABLE IF NOT EXISTS public.mock_tests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  test_type       TEXT        NOT NULL DEFAULT 'full'
                              CHECK (test_type IN ('full','sectional','chapter','previous_year')),
  subjects        TEXT[]      NOT NULL DEFAULT '{}',
  score           REAL        NOT NULL CHECK (score >= 0 AND score <= 100),
  max_score       REAL        NOT NULL DEFAULT 100,
  duration_min    INT         NOT NULL DEFAULT 180,
  subject_scores  JSONB       NOT NULL DEFAULT '{}',      -- { "Physics": 64, "Chemistry": 71, ... }
  weak_topics     TEXT[]      NOT NULL DEFAULT '{}',
  notes           TEXT        NOT NULL DEFAULT '',
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mock_student_idx
  ON public.mock_tests(student_id, taken_at DESC);
GRANT ALL ON public.mock_tests TO service_role;
ALTER TABLE public.mock_tests ENABLE ROW LEVEL SECURITY;

-- ─── Learner model extensions ────────────────────────────
-- Long-term traits that go beyond a single snapshot.
ALTER TABLE public.learner_model_snapshots
  ADD COLUMN IF NOT EXISTS learning_speed         REAL    NOT NULL DEFAULT 0,   -- atoms gained per study-hour
  ADD COLUMN IF NOT EXISTS retention_decay        REAL    NOT NULL DEFAULT 0.07,-- per-day forgetting rate
  ADD COLUMN IF NOT EXISTS stress_periods         JSONB   NOT NULL DEFAULT '[]',-- [{ from, to, severity }]
  ADD COLUMN IF NOT EXISTS preferred_explanations JSONB   NOT NULL DEFAULT '{}';-- { visual: 0.6, analogies: 0.3, ... }
