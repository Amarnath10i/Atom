-- ═══════════════════════════════════════════════════════════════════════════
-- LAMA — 20260614000000_fix_atom_dedup.sql
--
-- Root cause:
--   The "is this atom new?" check in /api/chat.ts compared subject + topic
--   as raw strings returned by the LLM.  Slight rephrasing ("Math" vs
--   "Mathematics", "kinematics" vs "Kinematics") caused the lookup to miss,
--   so a second atom was inserted instead of the original being updated.
--   No DB constraint existed to catch or reject the duplicate.
--
-- This migration does FIVE things:
--   1. Creates  lama_canonical_subject() — a stable mapping for subject names
--   2. Normalises ALL existing rows (subject → canonical, topic → lowercase-trimmed)
--   3. Merges  duplicate groups: keeps the atom with the most reviews,
--      re-points every memory_bonds reference, absorbs aggregate stats,
--      collapses any duplicate bonds, then deletes the leftover rows
--   4. Installs a BEFORE INSERT OR UPDATE trigger so every future write
--      is normalised before it reaches the table
--   5. Adds a UNIQUE index on (student_id, subject, topic) so the DB
--      itself rejects any remaining duplicates (last-line-of-defence)
--
-- Idempotent: safe to run more than once (uses IF NOT EXISTS / OR REPLACE).
-- Run via:  supabase db push   ·OR·  paste into the Supabase SQL editor.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. Canonical subject function ────────────────────────────────────────────
--    Maps every LLM variant → a single stable string.
--    Add extra rows here whenever a new alias appears in prod logs.
CREATE OR REPLACE FUNCTION lama_canonical_subject(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE LOWER(TRIM(raw))
    WHEN 'math'        THEN 'Maths'
    WHEN 'maths'       THEN 'Maths'
    WHEN 'mathematics' THEN 'Maths'
    WHEN 'physics'     THEN 'Physics'
    WHEN 'chemistry'   THEN 'Chemistry'
    WHEN 'chem'        THEN 'Chemistry'
    WHEN 'biology'     THEN 'Biology'
    WHEN 'bio'         THEN 'Biology'
    WHEN 'general'     THEN 'General'
    ELSE INITCAP(TRIM(raw))          -- unknown subjects: Title-cased
  END;
$$;


-- ── 2. Normalise every existing row ──────────────────────────────────────────
UPDATE public.memory_atoms
SET
  subject = lama_canonical_subject(subject),
  -- Lower-case, single-space, trim — so "Kinematics" = "kinematics" = "kinematics "
  topic   = LOWER(TRIM(regexp_replace(topic, '\s+', ' ', 'g')));


-- ── 3. Merge duplicate groups ─────────────────────────────────────────────────
DO $$
DECLARE
  grp    RECORD;   -- one duplicate group: (student_id, subject, topic)
  winner UUID;     -- the atom we keep
BEGIN

  -- Iterate over every group that has more than one atom after normalisation
  FOR grp IN (
    SELECT student_id, subject, topic
    FROM   public.memory_atoms
    GROUP  BY student_id, subject, topic
    HAVING COUNT(*) > 1
  ) LOOP

    -- ── 3a. Choose winner ────────────────────────────────────────────────────
    --   Priority: most reviews (proxy for "seen most") → highest strength →
    --             oldest (created_at ASC = most stable row).
    SELECT id INTO winner
    FROM   public.memory_atoms
    WHERE  student_id = grp.student_id
      AND  subject    = grp.subject
      AND  topic      = grp.topic
    ORDER  BY reviews DESC, strength DESC, created_at ASC
    LIMIT  1;

    -- ── 3b. Absorb aggregate stats into winner ───────────────────────────────
    --   strength      → highest across duplicates (don't weaken the winner)
    --   reviews       → sum (student did all those reviews, just spread across rows)
    --   last_reviewed → most recent
    UPDATE public.memory_atoms w
    SET
      strength      = sub.max_str,
      reviews       = sub.total_rev,
      last_reviewed = sub.latest_rev
    FROM (
      SELECT
        MAX(strength)      AS max_str,
        SUM(reviews)       AS total_rev,
        MAX(last_reviewed) AS latest_rev
      FROM   public.memory_atoms
      WHERE  student_id = grp.student_id
        AND  subject    = grp.subject
        AND  topic      = grp.topic
    ) sub
    WHERE w.id = winner;

    -- ── 3c. Re-point bonds: source_atom ──────────────────────────────────────
    UPDATE public.memory_bonds
    SET   source_atom = winner
    WHERE source_atom IN (
      SELECT id FROM public.memory_atoms
      WHERE  student_id = grp.student_id
        AND  subject    = grp.subject
        AND  topic      = grp.topic
        AND  id        <> winner
    );

    -- ── 3d. Re-point bonds: target_atom ──────────────────────────────────────
    UPDATE public.memory_bonds
    SET   target_atom = winner
    WHERE target_atom IN (
      SELECT id FROM public.memory_atoms
      WHERE  student_id = grp.student_id
        AND  subject    = grp.subject
        AND  topic      = grp.topic
        AND  id        <> winner
    );

    -- ── 3e. Remove self-loops created by re-pointing ─────────────────────────
    DELETE FROM public.memory_bonds
    WHERE student_id = grp.student_id
      AND source_atom = winner
      AND target_atom = winner;

    -- ── 3f. Collapse duplicate bonds (same source→target, now merged) ─────────
    DELETE FROM public.memory_bonds b
    USING (
      SELECT MIN(id) AS keep_id, student_id, source_atom, target_atom
      FROM   public.memory_bonds
      WHERE  student_id = grp.student_id
      GROUP  BY student_id, source_atom, target_atom
      HAVING COUNT(*) > 1
    ) dupes
    WHERE b.student_id  = dupes.student_id
      AND b.source_atom = dupes.source_atom
      AND b.target_atom = dupes.target_atom
      AND b.id         <> dupes.keep_id;

    -- ── 3g. Delete the duplicate atoms (winner stays) ─────────────────────────
    DELETE FROM public.memory_atoms
    WHERE  student_id = grp.student_id
      AND  subject    = grp.subject
      AND  topic      = grp.topic
      AND  id        <> winner;

  END LOOP;
END $$;


-- ── 4. BEFORE INSERT / UPDATE trigger — normalise every future write ──────────
--    This means even if the TypeScript layer sends "Math" or "  Kinematics  ",
--    the stored row is always canonical → the unique index below never splits
--    what should be the same atom.

CREATE OR REPLACE FUNCTION trg_fn_normalize_atom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.subject := lama_canonical_subject(NEW.subject);
  NEW.topic   := LOWER(TRIM(regexp_replace(NEW.topic, '\s+', ' ', 'g')));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_atom ON public.memory_atoms;
CREATE TRIGGER trg_normalize_atom
  BEFORE INSERT OR UPDATE ON public.memory_atoms
  FOR EACH ROW EXECUTE FUNCTION trg_fn_normalize_atom();


-- ── 5. Unique index — hard DB-level guard ────────────────────────────────────
--    The trigger runs before this constraint is checked, so comparisons are
--    always against the normalised form.  Any INSERT or UPDATE that would
--    produce a duplicate is rejected with error 23505 (unique_violation)
--    instead of silently creating a second row.

-- Remove the original non-unique index (atoms_student_idx from first migration)
DROP INDEX IF EXISTS public.atoms_student_idx;

-- Unique constraint on the normalised triple
CREATE UNIQUE INDEX IF NOT EXISTS atoms_student_subject_topic_uniq
  ON public.memory_atoms(student_id, subject, topic);

-- Plain student_id index still needed for broad SELECT ... WHERE student_id = $1
CREATE INDEX IF NOT EXISTS atoms_student_id_idx
  ON public.memory_atoms(student_id);
