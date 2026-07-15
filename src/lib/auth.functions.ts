import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Returns { profile, roles, student } for the signed-in user. */
export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const [profile, roles, student] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", uid).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", uid),
      supabaseAdmin.from("students").select("*").eq("auth_user_id", uid).maybeSingle(),
    ]);
    return {
      userId: uid,
      profile: profile.data,
      roles: (roles.data ?? []).map((r) => r.role as "admin" | "student"),
      student: student.data,
    };
  });

const CreateStudentSchema = z.object({
  name: z.string().min(1).max(80),
  exam: z.enum(["JEE", "NEET"]),
  grade: z.number().int().min(8).max(13).default(12),
  language: z.enum(["english", "hinglish"]).default("english"),
  city: z.string().max(80).optional(),
});

/** Create-or-update the student row linked to the current user (called after signup). */
export const upsertMyStudent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CreateStudentSchema.parse(i))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: existing } = await supabaseAdmin
      .from("students")
      .select("id")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (existing) {
      const { data: row, error } = await supabaseAdmin
        .from("students")
        .update({
          name: data.name,
          exam: data.exam,
          grade: data.grade,
          language: data.language,
          city: data.city ?? null,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabaseAdmin
      .from("students")
      .insert({
        auth_user_id: uid,
        name: data.name,
        exam: data.exam,
        grade: data.grade,
        language: data.language,
        city: data.city ?? null,
        avatar_emoji: "🎓",
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Returns the LAMA architecture (atoms + bonds + reflections) for the current user. */
export const getMyArchitecture = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin
      .from("students")
      .select("*")
      .eq("auth_user_id", uid)
      .maybeSingle();
    if (!student) {
      return { student: null, atoms: [], bonds: [], weak: [], reflections: [] };
    }
    const sid = student.id;
    const [atoms, bonds, weak, refl] = await Promise.all([
      supabaseAdmin.from("memory_atoms").select("*").eq("student_id", sid),
      supabaseAdmin.from("memory_bonds").select("*").eq("student_id", sid),
      supabaseAdmin
        .from("weak_topics")
        .select("*")
        .eq("student_id", sid)
        .order("severity", { ascending: false }),
      supabaseAdmin
        .from("reflections")
        .select("*")
        .eq("student_id", sid)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    return {
      student,
      atoms: atoms.data ?? [],
      bonds: bonds.data ?? [],
      weak: weak.data ?? [],
      reflections: refl.data ?? [],
    };
  });

/** Fetch meta-cognitive pattern graph data. */
export const getMyMetaCognitive = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const { data: student } = await supabaseAdmin.from("students").select("id").eq("auth_user_id", uid).maybeSingle();
    if (!student) throw new Error("No student profile found");

    const [patternsRes, predictionsRes] = await Promise.all([
      supabaseAdmin.from("pattern_atoms").select("*").eq("student_id", student.id).order("confidence", { ascending: false }),
      supabaseAdmin.from("pattern_predictions").select("*").eq("student_id", student.id).order("created_at", { ascending: false }).limit(50),
    ]);

    return {
      student,
      patterns: patternsRes.data ?? [],
      predictions: predictionsRes.data ?? [],
    };
  });
