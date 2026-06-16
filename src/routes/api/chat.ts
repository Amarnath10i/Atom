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
        const memoryAtoms = [...recentAtoms, ...relevantAtoms.slice(0, 8)];
        const memorySummary = memoryAtoms
          .map((a) => {
            const ms = (a as { methods_seen?: unknown }).methods_seen;
            const methods = Array.isArray(ms) && ms.length
              ? ` methods=[${(ms as string[]).join(",")}]`
              : "";
            return `- [${a.subject}/${a.topic}] strength=${a.strength.toFixed(2)} reviews=${a.reviews}${methods}: ${a.summary}`;
          })
          .join("\n");

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

LONG-TERM MEMORY — LAMA Atoms (most recently reviewed)
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

YOU ARE THE ORCHESTRATOR. You invoke these 4 specialist sub-agents as tools when appropriate:
1. diagnose_weakness  — Diagnostic Agent: log a newly detected weak topic with evidence.
2. generate_practice  — Content Curator Agent: generate a practice question with NCERT alignment.
3. update_plan        — Planner Agent: add a study-plan item to the 6-month roadmap.
4. reflect_session    — Critic/Reflector Agent: store a session reflection, update memory atoms, build bonds.

RULES
- Reference past LAMA atoms when explaining ("You struggled with this last session, let's fix it.").
- Be warm, specific, and India-aware: NCERT chapters, JEE/NEET pattern, Hindi-medium friendly.
- Format every answer with clear structure: a short intro, then numbered **steps** with bold headings, then a final boxed answer line.
- ALWAYS write math in LaTeX with proper delimiters: inline as $...$ and display/block equations as $$...$$ on their own line. Never write raw symbols like "x^2" or "alpha" outside math delimiters. Example: $\alpha + (\alpha+2) = -(n+1)$ inline, and
  $$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$$
  as a display equation. The frontend renders KaTeX, so well-formed LaTeX appears beautifully.
- Use markdown headings (##), **bold key terms**, numbered lists, and tables when helpful.
- When the student uploads an image or PDF, READ IT — describe what you see and solve the question shown.
- Call tools naturally — don't narrate tool calls to the student.
- Keep responses focused: long enough to teach, short enough to hold attention.
- Never give medical/legal advice.
- You have NemoGuard safety active: do not generate harmful content.

IMPORTANT — atom subject must be exactly one of: Physics | Chemistry | Maths | Biology | General
(use "Maths" not "Math" — the memory store is case-sensitive after normalisation)`;

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
                  const next = Math.max(0.05, Math.min(0.98, existing.strength + args.strength_delta));
                  await supabaseAdmin
                    .from("memory_atoms")
                    .update({
                      strength: next,
                      reviews: existing.reviews + 1,
                      last_reviewed: new Date().toISOString(),
                      summary: args.atom_summary,
                    })
                    .eq("id", existing.id);
                  atomId = existing.id;
                } else {
                  const { data: created } = await supabaseAdmin
                    .from("memory_atoms")
                    .insert({
                      student_id: studentId,
                      subject: atomSubject,      // ← normalised
                      topic: atomTopic,          // ← normalised
                      summary: args.atom_summary,
                      strength: Math.max(0.2, 0.5 + args.strength_delta),
                    })
                    .select()
                    .single();
                  atomId = created!.id;
                  atomsAdded = 1;
                }

                // Bond to most recently reviewed atom (build LAMA graph)
                const { data: recent } = await supabaseAdmin
                  .from("memory_atoms")
                  .select("id")
                  .eq("student_id", studentId)
                  .neq("id", atomId)
                  .order("last_reviewed", { ascending: false })
                  .limit(1);

                let bondsAdded = 0;
                if (recent?.[0]) {
                  await supabaseAdmin.from("memory_bonds").insert({
                    student_id: studentId,
                    source_atom: recent[0].id,
                    target_atom: atomId,
                    relation: "session-link",
                    weight: 0.5 + args.strength_delta,
                  });
                  bondsAdded = 1;
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
                  "Extract one knowledge atom from the exchange. Reply with STRICT JSON only " +
                  "(no markdown fences) of shape: " +
                  '{"subject":"Physics|Chemistry|Maths|Biology|General","topic":"<short topic>","summary":"<1-2 sentence learning summary>","strength_delta":<number between -0.2 and 0.2>}. ' +
                  // ↑ FIX: "Maths" not "Math" — matches the canonical form in
                  //   SUBJECT_CANON so the lookup below always hits on the first try.
                  "Pick strength_delta based on whether the student showed mastery (positive) or struggled (negative).",
                prompt: `STUDENT QUERY:\n${lastText}\n\nTUTOR RESPONSE:\n${text}`,
              });
              const cleaned = rawJson.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
              const atom = JSON.parse(cleaned) as {
                subject: string; topic: string; summary: string; strength_delta: number;
              };
              if (atom?.subject && atom?.topic && atom?.summary) {
                const delta = Math.max(-0.2, Math.min(0.2, Number(atom.strength_delta) || 0));

                // ── FIX: normalise before lookup — prevents "Math" vs "Maths"
                //   (and similar variations) from splitting into two atoms ────
                const subject = canonicalSubject(atom.subject);
                const topic   = canonicalTopic(atom.topic);

                const { data: existing } = await supabaseAdmin
                  .from("memory_atoms")
                  .select("id,strength,reviews")
                  .eq("student_id", studentId)
                  .eq("subject", subject)     // ← normalised
                  .eq("topic", topic)         // ← normalised
                  .maybeSingle();
                if (existing) {
                  await supabaseAdmin.from("memory_atoms").update({
                    strength: Math.max(0.05, Math.min(0.98, existing.strength + delta)),
                    reviews: existing.reviews + 1,
                    last_reviewed: new Date().toISOString(),
                    summary: atom.summary,
                  } as never).eq("id", existing.id);
                } else {
                  await supabaseAdmin.from("memory_atoms").insert({
                    student_id: studentId,
                    subject: subject,      // ← normalised
                    topic: topic,          // ← normalised
                    summary: atom.summary,
                    strength: Math.max(0.2, Math.min(0.9, 0.5 + delta)),
                  } as never);
                }
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
