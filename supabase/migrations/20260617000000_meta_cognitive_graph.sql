-- =========================================================
--  Learning OS v5 — Meta-Cognitive Pattern Graph
-- =========================================================

-- ─── Meta-Cognitive Pattern Atoms ────────────────────────
-- Tracks specific meta-cognitive traits or recurring thought patterns.
CREATE TABLE IF NOT EXISTS public.pattern_atoms (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  pattern_type    TEXT        NOT NULL,                   -- e.g., 'calculation_rush', 'visual_learner'
  description     TEXT        NOT NULL,
  confidence      REAL        NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1.0),
  success_rate    REAL        NOT NULL DEFAULT 0.5,       -- Tracks RL success rate
  occurrences     INT         NOT NULL DEFAULT 1,
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, pattern_type)
);
CREATE INDEX IF NOT EXISTS pattern_atoms_student_idx
  ON public.pattern_atoms(student_id, confidence DESC);
GRANT ALL ON public.pattern_atoms TO service_role;
ALTER TABLE public.pattern_atoms ENABLE ROW LEVEL SECURITY;

-- ─── Pattern Predictions ─────────────────────────────────
-- Stores the background predictions made by the agent to be validated in the next turn.
CREATE TABLE IF NOT EXISTS public.pattern_predictions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  thread_id       UUID        NOT NULL,
  predicted_intent TEXT       NOT NULL,
  related_pattern_id UUID     REFERENCES public.pattern_atoms(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'correct', 'incorrect', 'ignored')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pattern_predictions_student_idx
  ON public.pattern_predictions(student_id, thread_id, status);
GRANT ALL ON public.pattern_predictions TO service_role;
ALTER TABLE public.pattern_predictions ENABLE ROW LEVEL SECURITY;
