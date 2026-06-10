-- ─── LAMA: agents + nucleus memory extension ────────────────────────────────

-- Atom state enum + columns
DO $$ BEGIN
  CREATE TYPE atom_state AS ENUM ('active','stuck','completed','planned','stale');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.memory_atoms
  ADD COLUMN IF NOT EXISTS state atom_state NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS state_reason TEXT,
  ADD COLUMN IF NOT EXISTS state_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS nucleus_text TEXT,
  ADD COLUMN IF NOT EXISTS nucleus_vector JSONB,
  ADD COLUMN IF NOT EXISTS semantic_mass REAL NOT NULL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS recency REAL NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS gravity REAL NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS privacy_flag BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS atoms_state_idx ON public.memory_atoms(student_id, state);
CREATE INDEX IF NOT EXISTS atoms_gravity_idx ON public.memory_atoms(student_id, gravity DESC);

-- Agent run audit log
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,           -- 'curator' | 'diagnostic' | 'planner' | 'state' | 'nucleus'
  status TEXT NOT NULL DEFAULT 'ok',
  summary TEXT,
  payload JSONB,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_student_idx
  ON public.agent_runs(student_id, created_at DESC);
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Safety event log (NeMo / regex blocks)
CREATE TABLE IF NOT EXISTS public.safety_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.threads(id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  reason TEXT,
  mode TEXT,                     -- 'nemo' | 'builtin'
  input_excerpt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_events_student_idx
  ON public.safety_events(student_id, created_at DESC);
GRANT ALL ON public.safety_events TO service_role;
ALTER TABLE public.safety_events ENABLE ROW LEVEL SECURITY;
