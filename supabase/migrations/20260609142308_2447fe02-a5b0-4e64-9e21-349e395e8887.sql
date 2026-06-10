
-- Students (simulated cohort)
CREATE TABLE public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  exam TEXT NOT NULL CHECK (exam IN ('JEE','NEET')),
  grade INT NOT NULL DEFAULT 12,
  language TEXT NOT NULL DEFAULT 'english' CHECK (language IN ('english','hinglish')),
  avatar_emoji TEXT NOT NULL DEFAULT '🎓',
  city TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.students TO service_role;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New session',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX threads_student_idx ON public.threads(student_id, updated_at DESC);
GRANT ALL ON public.threads TO service_role;
ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  agent TEXT NOT NULL DEFAULT 'tutor',
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON public.messages(thread_id, created_at ASC);
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.memory_atoms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  reviews INT NOT NULL DEFAULT 0,
  last_reviewed TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX atoms_student_idx ON public.memory_atoms(student_id);
GRANT ALL ON public.memory_atoms TO service_role;
ALTER TABLE public.memory_atoms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.memory_bonds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  source_atom UUID NOT NULL REFERENCES public.memory_atoms(id) ON DELETE CASCADE,
  target_atom UUID NOT NULL REFERENCES public.memory_atoms(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'related',
  weight REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bonds_student_idx ON public.memory_bonds(student_id);
GRANT ALL ON public.memory_bonds TO service_role;
ALTER TABLE public.memory_bonds ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.weak_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  severity REAL NOT NULL DEFAULT 0.5,
  evidence TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX weak_student_idx ON public.weak_topics(student_id, severity DESC);
GRANT ALL ON public.weak_topics TO service_role;
ALTER TABLE public.weak_topics ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  week INT NOT NULL,
  subject TEXT NOT NULL,
  topic TEXT NOT NULL,
  activity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped')),
  due_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_student_idx ON public.plan_items(student_id, week);
GRANT ALL ON public.plan_items TO service_role;
ALTER TABLE public.plan_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  thread_id UUID REFERENCES public.threads(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  bonds_added INT NOT NULL DEFAULT 0,
  atoms_added INT NOT NULL DEFAULT 0,
  next_focus TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refl_student_idx ON public.reflections(student_id, created_at DESC);
GRANT ALL ON public.reflections TO service_role;
ALTER TABLE public.reflections ENABLE ROW LEVEL SECURITY;

-- (Demo/seed cohort intentionally omitted — start with a clean database.)
