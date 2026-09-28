-- Values the tutor learns per student instead of hard-coding.

-- Exam unit (e.g. "Mechanics") the model assigns when it first records a
-- topic; used to weigh topics by exam weightage.
ALTER TABLE public.memory_atoms
  ADD COLUMN IF NOT EXISTS exam_unit TEXT;

-- Personal forgetting speed: >1 means this student retains longer than the
-- default curve predicts, <1 means they forget faster. Adjusted each time a
-- topic is revisited and the actual recall is compared with the prediction.
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS memory_stability REAL NOT NULL DEFAULT 1.0;
