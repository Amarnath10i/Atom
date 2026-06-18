-- =========================================================
--  Learning OS  — Phase 1 / 2 / 3  tables
--  Builds on top of the existing foundation (atoms, bonds,
--  weak_topics, reflections, agent_runs, etc.)
-- =========================================================

-- ─── PHASE 1: Outcome events ─────────────────────────────
-- Records every quiz / practice / recall attempt per topic.
CREATE TABLE IF NOT EXISTS public.outcome_events (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  thread_id    UUID        REFERENCES public.threads(id)           ON DELETE SET NULL,
  subject      TEXT        NOT NULL,
  topic        TEXT        NOT NULL,
  score        REAL        NOT NULL CHECK (score >= 0 AND score <= 1),
  event_type   TEXT        NOT NULL DEFAULT 'quiz'
                              CHECK (event_type IN ('quiz','practice','recall','simulation')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outcome_student_idx ON public.outcome_events(student_id, created_at DESC);
GRANT ALL ON public.outcome_events TO service_role;
ALTER TABLE public.outcome_events ENABLE ROW LEVEL SECURITY;

-- ─── PHASE 1: Curriculum nodes ───────────────────────────
-- Structured prerequisite graph per student.
CREATE TABLE IF NOT EXISTS public.curriculum_nodes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject          TEXT        NOT NULL,
  topic            TEXT        NOT NULL,
  prerequisites    TEXT[]      NOT NULL DEFAULT '{}',
  mastery          REAL        NOT NULL DEFAULT 0   CHECK (mastery >= 0 AND mastery <= 1),
  priority         INT         NOT NULL DEFAULT 5   CHECK (priority BETWEEN 1 AND 10),
  estimated_hours  INT         NOT NULL DEFAULT 2,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject, topic)
);
CREATE INDEX curriculum_student_idx ON public.curriculum_nodes(student_id);
GRANT ALL ON public.curriculum_nodes TO service_role;
ALTER TABLE public.curriculum_nodes ENABLE ROW LEVEL SECURITY;

-- ─── PHASE 1: Learner-model snapshots ───────────────────
-- Point-in-time snapshot of the inferred learner state.
CREATE TABLE IF NOT EXISTS public.learner_model_snapshots (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  learning_velocity     REAL        NOT NULL DEFAULT 0,   -- atoms/day
  retention_rate        REAL        NOT NULL DEFAULT 0,   -- 0-1
  strongest_subjects    TEXT[]      NOT NULL DEFAULT '{}',
  weakest_subjects      TEXT[]      NOT NULL DEFAULT '{}',
  predicted_exam_score  REAL        NOT NULL DEFAULT 0,   -- 0-100
  session_count         INT         NOT NULL DEFAULT 0,
  total_atoms           INT         NOT NULL DEFAULT 0,
  avg_strength          REAL        NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX learner_model_student_idx
  ON public.learner_model_snapshots(student_id, created_at DESC);
GRANT ALL ON public.learner_model_snapshots TO service_role;
ALTER TABLE public.learner_model_snapshots ENABLE ROW LEVEL SECURITY;

-- ─── PHASE 2: Simulation runs ────────────────────────────
-- Records every "learning simulator" run so the user can
-- compare before/after atom strengths.
CREATE TABLE IF NOT EXISTS public.simulation_runs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  atoms_before    JSONB       NOT NULL DEFAULT '[]',
  atoms_after     JSONB       NOT NULL DEFAULT '[]',
  delta_summary   TEXT        NOT NULL DEFAULT '',
  strategy        TEXT        NOT NULL DEFAULT 'spaced_repetition',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sim_student_idx ON public.simulation_runs(student_id, created_at DESC);
GRANT ALL ON public.simulation_runs TO service_role;
ALTER TABLE public.simulation_runs ENABLE ROW LEVEL SECURITY;

-- ─── PHASE 3: Exam strategies ────────────────────────────
CREATE TABLE IF NOT EXISTS public.exam_strategies (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id       UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  strategy_text    TEXT        NOT NULL,
  weeks_to_exam    INT         NOT NULL DEFAULT 8,
  generated_by     TEXT        NOT NULL DEFAULT 'ai',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.exam_strategies TO service_role;
ALTER TABLE public.exam_strategies ENABLE ROW LEVEL SECURITY;

-- ─── PHASE 3: Counterfactual logs ───────────────────────
CREATE TABLE IF NOT EXISTS public.counterfactual_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  question        TEXT        NOT NULL,
  analysis        TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.counterfactual_logs TO service_role;
ALTER TABLE public.counterfactual_logs ENABLE ROW LEVEL SECURITY;

-- ─── Policies (service_role bypasses RLS automatically) ─
-- No additional policies needed — all access is via service_role in server functions.
