// @ts-nocheck
/**
 * LAMA — /api/chat  (POST)
 *
 * 5-agent agentic loop:
 *   NemoGuard safety → Curator (memory retrieval) → Diagnostic → Planner →
 *   LLM (Gemini or Claude via .env) → Critic/Reflector
 *
 * No hardcoded API keys — everything read from .env at request time.
 */
import { createFileRoute } from "@tanstack/react-router";
import { streamText, tool, convertToCoreMessages } from "ai";
import { z } from "zod";
import { getAIProvider } from "@/lib/ai-gateway.server";
import { calculateSM2 } from "@/lib/learning-os.functions";
import { JEE_WEIGHTAGE, NEET_WEIGHTAGE } from "@/lib/exam-weightage";

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type Body = {
  messages?: unknown;
  studentId?: string;
  threadId?: string;
  language?: "english" | "hinglish";
  provider?: "gemini" | "claude" | "nvidia";
};

// ── NemoGuard-style built-in safety regex ─────────────────────────────────────
const HARMFUL_RE =
  /\b(suicide|kill (myself|him|her|yourself)|self[- ]harm|bomb|weapon|explosiv|poison recipe)\b/i;

const SAFETY_HELPLINE =
  "For support, please reach out to iCall: 9152987821 or Vandrevala Foundation: 1860-2662-345.";

// ── Atom field canonicalization ───────────────────────────────────────────────
//
// ROOT CAUSE FIXED HERE:
//   The "is this atom new?" check compared subject + topic as raw strings
//   returned by the LLM. Because those strings are freely generated on every
//   tool call, slight rephrasing ("Math" vs "Mathematics", "Kinematics" vs
//   "kinematics") caused the exact-match .eq() lookup to miss, so the code
//   treated it as a brand-new topic and inserted a duplicate row rather than
//   updating the original — and no DB constraint existed to catch it.
//
// FIX: normalise subject + topic BEFORE every SELECT and INSERT so the lookup
// always hits the same canonical form.  The companion SQL migration adds a
// BEFORE INSERT/UPDATE trigger (belt) and a UNIQUE index (braces) at the DB
// layer so any write that slips through the app layer is also rejected.
//
const SUBJECT_CANON: Record<string, string> = {
  math: "Maths",        maths: "Maths",   mathematics: "Maths",
  physics: "Physics",
  chemistry: "Chemistry", chem: "Chemistry",
  biology: "Biology",   bio: "Biology",
  general: "General",
};

/** Only these subjects are valid for JEE/NEET memory atoms. */
const VALID_SUBJECTS = new Set(["Physics", "Chemistry", "Maths", "Biology"]);

/** Map any LLM-generated subject string to its single canonical form. */
function canonicalSubject(raw: string): string {
  const key = raw.trim().toLowerCase();
  return (
    SUBJECT_CANON[key] ??
    (raw.trim().charAt(0).toUpperCase() + raw.trim().slice(1))
  );
}

/** Normalise a topic: trim, collapse internal whitespace, lower-case.
 *  Matches the DB trigger in the companion migration. */
function canonicalTopic(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}
// ─────────────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // ── Parse body ──────────────────────────────────────────────────────
        const body = (await request.json()) as Body;
        const messages = body.messages as ChatMessage[] | undefined;
        if (!Array.isArray(messages) || !body.studentId || !body.threadId) {
          return new Response("messages, studentId, threadId required", { status: 400 });
        }
        const studentId: string = body.studentId;
        const threadId: string = body.threadId;

        // ── Resolve LLM provider from .env (no hardcoded keys) ─────────────
        // UI may pass `provider: "gemini" | "claude"` to override per request.
        let provider;
        try {
          provider = await getAIProvider(body.provider);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(
            JSON.stringify({ error: `LLM provider not configured: ${msg}` }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        // ── Extract last user message text ─────────────────────────────────
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        const lastText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";

        // ── Agent 0: NeMo Guardrails (via Python service) + regex fallback ──
        const { agents } = await import("@/lib/agents.bridge.server");
        let guard = await agents.guard(lastText);
        if (!guard._degraded && !guard.allowed) {
          await supabaseAdmin.from("safety_events").insert({
            student_id: studentId, thread_id: threadId,
            category: guard.category, reason: guard.reason, mode: guard.mode,
            input_excerpt: lastText.slice(0, 240),
          } as never);
          return new Response(JSON.stringify({
            error: `Blocked by LAMA safety guardrail (${guard.category}). ${guard.reason}${guard.helpline ? " · " + guard.helpline : ""}`,
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (guard._degraded && HARMFUL_RE.test(lastText)) {
          await supabaseAdmin.from("safety_events").insert({
            student_id: studentId, thread_id: threadId,
            category: "self_harm", reason: "regex fallback (agents offline)",
            mode: "builtin", input_excerpt: lastText.slice(0, 240),
          } as never);
          return new Response(JSON.stringify({
            error: `Blocked by LAMA safety guardrail. ${SAFETY_HELPLINE}`,
          }), { status: 200, headers: { "content-type": "application/json" } });
        }

        // ── Persist user message + ingest into Nucleus memory ───────────────
        if (lastUserMsg) {
          await supabaseAdmin.from("messages").insert({
            thread_id: threadId, role: "user", agent: "student",
            content: { parts: [{ type: "text", text: lastText }] } as never,
          });

          // ── Auto-title thread from first user message + bump updated_at ──
          // (sorts threads in the sidebar by most-recently-used)
          try {
            const { data: thread } = await supabaseAdmin
              .from("threads").select("title").eq("id", threadId).maybeSingle();
            const isDefault = !thread?.title
              || thread.title === "New session" || thread.title === "New chat";
            const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
            if (isDefault && lastText.trim()) {
              const oneLine = lastText.trim().replace(/\s+/g, " ");
              patch.title = oneLine.length > 60 ? oneLine.slice(0, 57) + "…" : oneLine;
            }
            await supabaseAdmin.from("threads").update(patch as never).eq("id", threadId);
          } catch (e) { console.warn("[chat] thread title update failed", e); }

          // Fire-and-forget: ingest nucleus (will populate when atom is created later)
          const { data: priorAtoms } = await supabaseAdmin.from("memory_atoms")
            .select("id,nucleus_vector").eq("student_id", studentId).limit(100);
          agents.nucleusIngest(lastText, priorAtoms ?? []).catch(() => {});
        }

        // ── Agent 1: Curator — load memory context ──────────────────────────
        const [{ data: student }, { data: atoms }, { data: weak }, { data: plan }] =
          await Promise.all([
            supabaseAdmin
              .from("students")
              .select("*")
              .eq("id", studentId)
              .maybeSingle(),
            supabaseAdmin
              .from("memory_atoms")
              .select("*")
              .eq("student_id", studentId)
              .order("last_reviewed", { ascending: false }),
            supabaseAdmin
              .from("weak_topics")
              .select("*")
              .eq("student_id", studentId)
              .order("severity", { ascending: false })
              .limit(5),
            supabaseAdmin
              .from("plan_items")
              .select("*")
              .eq("student_id", studentId)
              .eq("status", "pending")
              .order("week")
              .limit(3),
          ]);

        const lang = body.language ?? student?.language ?? "english";

        // LAMA molecular memory: hybrid retrieval = recency + semantic relevance.
        // Recency-only windows lose stale-but-relevant atoms for students with
        // 50+ atoms, so we merge /nucleus/search hits for the current message.
        const recentAtoms = (atoms ?? []).slice(0, 12);
        let relevantAtoms: typeof recentAtoms = [];
        if (lastText && (atoms ?? []).length > recentAtoms.length) {
          const res = await agents.nucleusSearch(lastText, atoms ?? [], 12);
          const hits = (res as { hits?: Array<{ id: string; sim: number }> }).hits ?? [];
          const recentIds = new Set(recentAtoms.map((a) => a.id));
          const byId = new Map((atoms ?? []).map((a) => [a.id, a]));
          relevantAtoms = hits
            .filter((h) => h.sim >= 0.35 && !recentIds.has(h.id))
            .map((h) => byId.get(h.id))
            .filter(Boolean) as typeof recentAtoms;
        }
        const nowMs = Date.now();
        const dueAtoms = (atoms ?? []).filter(a => {
          if (!a.sm2_next_review_date) return false; // don't show brand new atoms as due immediately unless explicitly set
          return new Date(a.sm2_next_review_date).getTime() <= nowMs;
        }).slice(0, 5);

        const formatAtom = (a: any) => {
          const ms = a.methods_seen;
          const methods = Array.isArray(ms) && ms.length ? ` methods=[${ms.join(",")}]` : "";
          const stateStr = a.state ? ` state=${a.state}` : "";
          return `- [${a.subject}/${a.topic}] strength=${a.strength.toFixed(2)} reviews=${a.reviews}${stateStr}${methods}: ${a.summary}`;
        };

        const memorySummary = [
          "RECENTLY STUDIED:",
          ...(recentAtoms.length ? recentAtoms.map(formatAtom) : ["(none)"]),
          "",
          "SEMANTICALLY RELEVANT (from nucleus search):",
          ...(relevantAtoms.length ? relevantAtoms.slice(0, 8).map(formatAtom) : ["(none)"]),
          "",
          "DUE FOR REVIEW (SM-2):",
          ...(dueAtoms.length ? dueAtoms.map(formatAtom) : ["(none)"]),
        ].join("\n");

        // Only assert a safety layer that is actually running.
        const safetyLine =
          guard.mode === "nemo"
            ? "NemoGuard / NemoClaw guardrails are active on every reply."
            : guard.mode === "builtin"
              ? "A built-in keyword-based safety filter is active (regex-level — do not rely on it as the sole net for sensitive content)."
              : "Safety guardrails are currently degraded; respond conservatively and avoid sensitive content.";

        // ── System prompt: Tutor agent orchestrating all sub-agents ─────────
        const system = `You are **LAMA** — the Layered Atomic Memory Architecture — acting as a personal JEE/NEET tutor.
You are running on the ${
  provider.name === "nvidia"
    ? `NVIDIA Nemotron (${provider.modelId})`
    : provider.name === "gemini"
    ? "Google Gemini"
    : "Anthropic Claude"
} LLM. ${safetyLine}

STUDENT PROFILE
- Name: ${student?.name ?? "Student"}
- Exam: ${student?.exam ?? "JEE"} | Grade: ${student?.grade ?? 12} | City: ${student?.city ?? "India"}
- Language mode: ${lang}${lang === "hinglish" ? " (reply in casual Hinglish — Hindi words in Roman script mixed with English; e.g. 'chal beta, ye concept samajhte hain')" : " (reply in clear, encouraging English)"}

LONG-TERM MEMORY — LAMA Atoms
${memorySummary || "(no atoms yet — this is the first session)"}

CURRENT WEAK TOPICS (Diagnostic Agent findings)
${
  (weak ?? [])
    .map((w) => `- ${w.subject}/${w.topic} severity=${w.severity.toFixed(2)}: ${w.evidence ?? ""}`)
    .join("\n") || "(none detected yet)"
}

UPCOMING STUDY PLAN (Planner Agent)
${
  (plan ?? [])
    .map((p) => `- Week ${p.week} | ${p.subject}/${p.topic}: ${p.activity}`)
    .join("\n") || "(no plan items yet)"
}

EXAM WEIGHTAGE (${student?.exam ?? "JEE"} — topic-wise marks %)
${(() => {
  const w = (student?.exam ?? "JEE") === "NEET" ? NEET_WEIGHTAGE : JEE_WEIGHTAGE;
  return Object.entries(w)
    .map(([subj, topics]) =>
      `${subj}: ` + Object.entries(topics).map(([t, pct]) => `${t} ${pct}%`).join(", ")
    )
    .join("\n");
})()}
Use these weightages to prioritise high-value topics. If a student is weak in a topic worth >10% of the exam, flag it urgently.

YOU ARE THE ORCHESTRATOR. You invoke these 4 specialist sub-agents as tools when appropriate:
1. diagnose_weakness  — Diagnostic Agent: log a newly detected weak topic with evidence.
2. generate_practice  — Content Curator Agent: generate a practice question with NCERT alignment.
3. update_plan        — Planner Agent: add a study-plan item to the 6-month roadmap.
4. reflect_session    — Critic/Reflector Agent: store a session reflection, update memory atoms, build bonds.

RULES
- CLARIFY FIRST, THEN EXTEND THE FIELD. Always fully resolve the student's actual question/doubt before anything else — make sure the current concept is genuinely clear. THEN, as a natural continuation, broaden the discussion into ONE closely-related concept that bridges the previous topic and this question, widening their view of the field (e.g. "...and this same idea is exactly what powers $X$", "...which is why $Y$ behaves the same way"). The extension should grow organically out of what was just discussed — connecting a known topic to an adjacent one.
- NEVER announce this as a recommendation or a syllabus instruction. Do NOT say "your next topic is...", "you should now study...", "the next topic is...", or list topics to cover. The new concept must appear as a seamless continuation of the same train of thought, not as a labelled "next step". Keep the extension brief — a bridge, not a second lecture.
- Reference past LAMA atoms when explaining ("You struggled with this last session, let's fix it.").
- Be warm, specific, and India-aware: NCERT chapters, JEE/NEET pattern, Hindi-medium friendly.
- Format every answer with clear structure: a short intro, then numbered **steps** with bold headings, then a final boxed answer line.
- ALWAYS write math in LaTeX with proper delimiters: inline as $...$ and display/block equations as $$...$$ on their own line. Never write raw symbols like "x^2" or "alpha" outside math delimiters. Example: $\alpha + (\alpha+2) = -(n+1)$ inline, and
  $$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$
  as a display equation. The frontend renders KaTeX, so well-formed LaTeX appears beautifully.
- Use markdown headings (##), **bold key terms**, numbered lists, and tables when helpful.
- When the student asks for a diagram, drawing, or visual explanation, generate ASCII diagrams, markdown tables, or use Mermaid-compatible syntax wrapped in code blocks. If the concept benefits from a visual (circuit diagrams, free-body diagrams, organic structures, biological cycles), proactively include one.
- When the student uploads an image or PDF, READ IT — describe what you see and solve the question shown.
- Call tools naturally — don't narrate tool calls to the student.
- Keep responses focused: long enough to teach, short enough to hold attention.
- Never give medical/legal advice.
- You have NemoGuard safety active: do not generate harmful content.

IMPORTANT — atom subject must be exactly one of: Physics | Chemistry | Maths | Biology
(use "Maths" not "Math" — the memory store is case-sensitive after normalisation)
Do NOT create atoms for non-academic topics like greetings, AI capabilities, or general conversation.`;

        // ── LLM + 4 agent tools ─────────────────────────────────────────────
        const result = streamText({
          model: provider.model,
          system,
          // convertToCoreMessages turns useChat UIMessages (including
          // experimental_attachments such as uploaded images / PDFs) into the
          // multimodal `parts` shape the providers actually understand, so the
          // model can now see image and PDF content instead of just a filename.
          messages: convertToCoreMessages(messages as never),
          // ai-sdk v4: maxSteps governs the agentic tool-call loop. In ai-sdk
          // v6 this becomes `stopWhen: stepCountIs(10)` (import stepCountIs from
          // "ai"). DO NOT shim it locally as `(n) => ({ maxSteps: n })` —
          // stopWhen expects a function `({ steps }) => boolean` and the shim
          // crashes the loop the moment any tool (diagnose_weakness,
          // generate_practice, update_plan, reflect_session) is called.
          maxSteps: 10,
          tools: {
            // Agent 2: Diagnostic
            diagnose_weakness: tool({
              description:
                "Diagnostic Agent: register a weak topic. Optionally record the structured gap taxonomy (last_approach_tried + worked) so re-explanation is deterministic instead of LLM-judgment-dependent.",
              parameters: z.object({
                subject: z.string(),
                topic: z.string(),
                severity: z.number().min(0).max(1),
                evidence: z.string(),
                last_approach_tried: z.string().optional(),
                worked: z.boolean().optional(),
              }),
              execute: async (args) => {
                const evidence =
                  args.last_approach_tried !== undefined || args.worked !== undefined
                    ? `${args.evidence} | approach=${args.last_approach_tried ?? "?"} worked=${args.worked ?? "?"}`
                    : args.evidence;
                await supabaseAdmin.from("weak_topics").insert({
                  student_id: studentId,
                  subject: args.subject,
                  topic: args.topic,
                  severity: args.severity,
                  evidence,
                });
                return { logged: true, ...args };
              },
            }),

            // Agent 3: Content Curator
            generate_practice: tool({
              description:
                "Content Curator Agent: generate a NCERT-aligned practice question. Pass an optional pair_topic (a known-strong topic to bond with the weak one) to produce an explicit cross-topic / integration-style problem instead of a single-topic drill. Pass an optional method to bias sequencing (familiar-method first, optimal-method second).",
              parameters: z.object({
                subject: z.string(),
                topic: z.string(),
                difficulty: z.number().int().min(1).max(5),
                pair_topic: z.string().optional(),
                method: z.string().optional(),
              }),
              execute: async (args) => {
                const base = `Generate a NCERT-aligned MCQ with 4 options (A-D) and a step-by-step solution. Match difficulty to atom strength.`;
                const hint = args.pair_topic
                  ? `Generate a NCERT-aligned MCQ that REQUIRES applying ${args.topic} together with ${args.pair_topic} — an integration-style problem. ${args.method ? `Prefer the ${args.method} method.` : ""} 4 options (A-D) and a step-by-step solution.`
                  : `${base}${args.method ? ` Prefer the ${args.method} method.` : ""}`;
                return { question_id: crypto.randomUUID(), ...args, hint };
              },
            }),

            // Agent 4: Planner
            update_plan: tool({
              description:
                "Planner Agent: add or update a study-plan item in the student's 6-month roadmap.",
              parameters: z.object({
                week: z.number().int().min(1).max(26),
                subject: z.string(),
                topic: z.string(),
                activity: z.string(),
              }),
              execute: async (args) => {
                const due = new Date();
                due.setDate(due.getDate() + args.week * 7);
                const { data: row } = await supabaseAdmin
                  .from("plan_items")
                  .insert({
                    student_id: studentId,
                    ...args,
                    due_on: due.toISOString().slice(0, 10),
                  })
                  .select()
                  .single();
                return row;
              },
            }),

            // Agent 5: Critic / Reflector (LAMA memory writer)
            reflect_session: tool({
              description:
                "Critic/Reflector Agent: store a session reflection, reinforce or create a memory atom, and build a bond in the LAMA graph.",
              parameters: z.object({
                summary: z.string(),
                atom_subject: z.string(),
                atom_topic: z.string(),
                atom_summary: z.string(),
                strength_delta: z.number().min(-0.3).max(0.3),
                next_focus: z.string(),
              }),
              execute: async (args) => {
                // ── FIX: normalise subject + topic before ANY DB access ──────
                // Previously used args.atom_subject / args.atom_topic raw, so
                // "Math" on one call and "Maths" on the next produced two atoms.
                const atomSubject = canonicalSubject(args.atom_subject);
                const atomTopic   = canonicalTopic(args.atom_topic);

                // Only allow JEE/NEET subjects — reject "General", "AI", etc.
                if (!VALID_SUBJECTS.has(atomSubject)) {
                  return `Reflected on session (atom subject "${atomSubject}" is not a valid JEE/NEET subject — skipped atom creation). Next focus: ${args.next_focus}`;
                }

                // Upsert atom (select-then-update-or-insert)
                const { data: existing } = await supabaseAdmin
                  .from("memory_atoms")
                  .select("*")
                  .eq("student_id", studentId)
                  .eq("subject", atomSubject)   // ← normalised
                  .eq("topic", atomTopic)        // ← normalised
                  .maybeSingle();

                let atomId: string;
                let atomsAdded = 0;

                if (existing) {
                  // Map strength delta (-0.3 to +0.3) to SM-2 quality (0 to 5)
                  const quality = args.strength_delta > 0.1 ? 5 : args.strength_delta > 0 ? 4 : args.strength_delta > -0.1 ? 3 : args.strength_delta > -0.2 ? 2 : 1;
                  const sm2 = calculateSM2(quality, existing.sm2_ef, existing.sm2_interval, existing.sm2_repetitions);
                  const next = Math.max(0.05, Math.min(0.98, existing.strength + args.strength_delta));
                  await supabaseAdmin
                    .from("memory_atoms")
                    .update({
                      strength: next,
                      reviews: existing.reviews + 1,
                      last_reviewed: new Date().toISOString(),
                      summary: args.atom_summary,
                      sm2_ef: sm2.ef,
                      sm2_interval: sm2.interval,
                      sm2_repetitions: sm2.repetitions,
                      sm2_next_review_date: sm2.nextReviewDate
                    })
                    .eq("id", existing.id);
                  atomId = existing.id;
                } else {
                  const sm2 = calculateSM2(args.strength_delta > 0 ? 4 : 3);
                  const { data: created } = await supabaseAdmin
                    .from("memory_atoms")
                    .insert({
                      student_id: studentId,
                      subject: atomSubject,      // ← normalised
                      topic: atomTopic,          // ← normalised
                      summary: args.atom_summary,
                      strength: Math.max(0.2, 0.5 + args.strength_delta),
                      sm2_ef: sm2.ef,
                      sm2_interval: sm2.interval,
                      sm2_repetitions: sm2.repetitions,
                      sm2_next_review_date: sm2.nextReviewDate
                    })
                    .select()
                    .single();
                  atomId = created!.id;
                  atomsAdded = 1;
                }

                // Bond to same-subject atoms (build a rich LAMA molecular graph)
                const { data: sameSubjectAtoms } = await supabaseAdmin
                  .from("memory_atoms")
                  .select("id, topic, strength")
                  .eq("student_id", studentId)
                  .eq("subject", atomSubject)
                  .neq("id", atomId)
                  .order("last_reviewed", { ascending: false })
                  .limit(5);

                let bondsAdded = 0;
                for (const related of (sameSubjectAtoms ?? [])) {
                  // Don't duplicate existing bonds
                  const { data: existingBond } = await supabaseAdmin
                    .from("memory_bonds")
                    .select("id")
                    .eq("student_id", studentId)
                    .or(`and(source_atom.eq.${atomId},target_atom.eq.${related.id}),and(source_atom.eq.${related.id},target_atom.eq.${atomId})`)
                    .limit(1);
                  if (existingBond && existingBond.length > 0) continue;

                  const bondWeight = 0.3 + Math.min(0.5, args.strength_delta * 0.5);
                  await supabaseAdmin.from("memory_bonds").insert({
                    student_id: studentId,
                    source_atom: atomId,
                    target_atom: related.id,
                    relation: "topic-link",
                    weight: Math.max(0.1, Math.min(1, bondWeight)),
                  });
                  bondsAdded++;
                }

                // Also bond to most recently reviewed atom from OTHER subjects (cross-subject bonds)
                const { data: crossSubjectRecent } = await supabaseAdmin
                  .from("memory_atoms")
                  .select("id")
                  .eq("student_id", studentId)
                  .neq("id", atomId)
                  .neq("subject", atomSubject)
                  .order("last_reviewed", { ascending: false })
                  .limit(1);
                if (crossSubjectRecent?.[0]) {
                  const { data: existingCross } = await supabaseAdmin
                    .from("memory_bonds")
                    .select("id")
                    .eq("student_id", studentId)
                    .or(`and(source_atom.eq.${atomId},target_atom.eq.${crossSubjectRecent[0].id}),and(source_atom.eq.${crossSubjectRecent[0].id},target_atom.eq.${atomId})`)
                    .limit(1);
                  if (!existingCross || existingCross.length === 0) {
                    await supabaseAdmin.from("memory_bonds").insert({
                      student_id: studentId,
                      source_atom: atomId,
                      target_atom: crossSubjectRecent[0].id,
                      relation: "session-link",
                      weight: 0.3,
                    });
                    bondsAdded++;
                  }
                }

                await supabaseAdmin.from("reflections").insert({
                  student_id: studentId,
                  thread_id: threadId,
                  summary: args.summary,
                  atoms_added: atomsAdded,
                  bonds_added: bondsAdded,
                  next_focus: args.next_focus,
                });

                return { ok: true, atom_id: atomId, atoms_added: atomsAdded, bonds_added: bondsAdded };
              },
            }),
          },

          onFinish: async ({ text }) => {
            if (!text) return;
            await supabaseAdmin.from("messages").insert({
              thread_id: threadId,
              role: "assistant",
              agent: "tutor",
              content: { parts: [{ type: "text", text }] } as never,
            });
            await supabaseAdmin
              .from("threads")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", threadId);

            // ── Auto memory-atom extraction (no hardcoding — LLM derives it) ──
            try {
              const { generateText } = await import("ai");
              const { text: rawJson } = await generateText({
                model: provider.model,
                system:
                  "Extract one JEE/NEET knowledge atom from the exchange. Reply with STRICT JSON only " +
                  "(no markdown fences) of shape: " +
                  '{"subject":"Physics|Chemistry|Maths|Biology","topic":"<short JEE/NEET topic>","summary":"<1-2 sentence learning summary>","strength_delta":<number between -0.2 and 0.2>}. ' +
                  "IMPORTANT: subject MUST be exactly Physics, Chemistry, Maths, or Biology. " +
                  "If the conversation is not about any of these subjects, respond with {\"subject\":\"skip\"}. " +
                  "The topic must be a real JEE/NEET syllabus topic (e.g. Kinematics, Organic Chemistry, Calculus, Human Physiology). " +
                  "Do NOT create atoms for general conversation, AI capabilities, greetings, etc. " +
                  "Pick strength_delta based on whether the student showed mastery (positive) or struggled (negative).",
                prompt: `STUDENT QUERY:\n${lastText}\n\nTUTOR RESPONSE:\n${text}`,
              });
              const cleaned = rawJson.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
              const atom = JSON.parse(cleaned) as {
                subject: string; topic: string; summary: string; strength_delta: number;
              };
              // Skip if subject is invalid
              if (atom?.subject === "skip" || !atom?.subject) throw new Error("Non-academic conversation");
              if (atom?.subject && atom?.topic && atom?.summary) {
                const delta = Math.max(-0.2, Math.min(0.2, Number(atom.strength_delta) || 0));

                // ── FIX: normalise before lookup — prevents "Math" vs "Maths"
                //   (and similar variations) from splitting into two atoms ────
                const subject = canonicalSubject(atom.subject);
                const topic   = canonicalTopic(atom.topic);

                // Only allow JEE/NEET subjects
                if (!VALID_SUBJECTS.has(subject)) {
                  console.log(`[chat] auto-extract skipped non-academic subject: ${subject}`);
                } else {
                const { data: existing } = await supabaseAdmin
                  .from("memory_atoms")
                  .select("id,strength,reviews,sm2_ef,sm2_interval,sm2_repetitions")
                  .eq("student_id", studentId)
                  .eq("subject", subject)     // ← normalised
                  .eq("topic", topic)         // ← normalised
                  .maybeSingle();
                if (existing) {
                  const quality = delta > 0.1 ? 5 : delta > 0 ? 4 : delta > -0.1 ? 3 : delta > -0.2 ? 2 : 1;
                  const sm2 = calculateSM2(quality, existing.sm2_ef, existing.sm2_interval, existing.sm2_repetitions);
                  await supabaseAdmin.from("memory_atoms").update({
                    strength: Math.max(0.05, Math.min(0.98, existing.strength + delta)),
                    reviews: existing.reviews + 1,
                    last_reviewed: new Date().toISOString(),
                    summary: atom.summary,
                    sm2_ef: sm2.ef,
                    sm2_interval: sm2.interval,
                    sm2_repetitions: sm2.repetitions,
                    sm2_next_review_date: sm2.nextReviewDate
                  } as never).eq("id", existing.id);
                } else {
                  const sm2 = calculateSM2(delta > 0 ? 4 : 3);
                  await supabaseAdmin.from("memory_atoms").insert({
                    student_id: studentId,
                    subject: subject,      // ← normalised
                    topic: topic,          // ← normalised
                    summary: atom.summary,
                    strength: Math.max(0.2, Math.min(0.9, 0.5 + delta)),
                    sm2_ef: sm2.ef,
                    sm2_interval: sm2.interval,
                    sm2_repetitions: sm2.repetitions,
                    sm2_next_review_date: sm2.nextReviewDate
                  } as never);
                }
                } // end VALID_SUBJECTS guard
              }
            } catch (e) {
              console.warn("[chat] atom auto-extract failed", e);
            }

            // ── State Inference Agent: re-label atoms based on transcript ──
            try {
              const [{ data: atomsAll }, { data: msgs }] = await Promise.all([
                supabaseAdmin.from("memory_atoms").select("*").eq("student_id", studentId),
                supabaseAdmin.from("messages").select("role,content")
                  .eq("thread_id", threadId).order("created_at", { ascending: true }).limit(40),
              ]);
              const stateRes = await agents.state(msgs ?? [], atomsAll ?? []);
              for (const u of (stateRes.updates ?? []) as Array<{ atom_id: string; state: string; reason?: string }>) {
                if (!u.atom_id || !u.state) continue;
                await supabaseAdmin.from("memory_atoms").update({
                  state: u.state, state_reason: u.reason,
                  state_updated_at: new Date().toISOString(),
                } as never).eq("id", u.atom_id);
              }
            } catch (e) { console.warn("[chat] state inference failed", e); }

            // ── Orchestrator Pipeline (Auto-Run) ──
            try {
              // 1. Diagnostic (update weak topics)
              const diagRes = await agents.diagnostic(msgs ?? [], atomsAll ?? []);
              if (diagRes?.weak_topics?.length) {
                // To avoid duplicate constraints without a unique index, we delete and re-insert for this student
                // Wait, it's better to just keep them rolling or delete all and insert
                await supabaseAdmin.from("weak_topics").delete().eq("student_id", studentId);
                const toInsert = diagRes.weak_topics.map((wt: any) => ({
                  student_id: studentId,
                  subject: canonicalSubject(wt.subject),
                  topic: canonicalTopic(wt.topic),
                  severity: wt.severity,
                  evidence: wt.evidence,
                }));
                await supabaseAdmin.from("weak_topics").insert(toInsert);
              }

              // 2. Planner (generate study plan if requested or if it's empty/due)
              const { data: weakTopics } = await supabaseAdmin.from("weak_topics").select("*").eq("student_id", studentId);
              const { data: currentPlan } = await supabaseAdmin.from("plan_items").select("*").eq("student_id", studentId).eq("status", "pending");
              
              // Only run planner if the plan is running low
              if ((currentPlan?.length ?? 0) < 3) {
                const planRes = await agents.planner(student?.exam ?? "JEE", weakTopics ?? [], currentPlan ?? []);
                if (planRes?.plan?.length) {
                  await supabaseAdmin.from("plan_items").delete().eq("student_id", studentId).eq("status", "pending");
                  const planInsert = planRes.plan.map((item: any) => ({
                    student_id: studentId,
                    subject: canonicalSubject(item.subject),
                    topic: canonicalTopic(item.topic),
                    week: item.week,
                    activity: item.activity,
                    status: 'pending'
                  }));
                  await supabaseAdmin.from("plan_items").insert(planInsert);
                }
              }

              // 3. Curator (run if memory atoms are getting large to prune/merge)
              if ((atomsAll?.length ?? 0) > 30) {
                 await agents.curator(atomsAll ?? []);
                 // For now curator in the backend handles its own logic or we apply it here.
                 // Actually curator returns merges, prunes, bonds. We can apply them here if we want,
                 // but let's keep it simple and assume the curator endpoint is fire-and-forget or we don't apply it yet
                 // as the original curator endpoint returned instructions.
              }

            } catch (e) {
              console.warn("[chat] orchestrator pipeline failed", e);
            }
          },
        });

        // Surface the REAL provider error to the UI instead of masking it.
        return result.toDataStreamResponse({
          getErrorMessage: (error: unknown) => {
            console.error("[chat] LLM stream error:", error);
            if (error == null) return "Unknown error";
            if (typeof error === "string") return error;
            if (error instanceof Error) return `${error.name}: ${error.message}`;
            return JSON.stringify(error);
          },
        });
      },
    },
  },
});
