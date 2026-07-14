// @ts-nocheck
/**
 * Real mock-test taker.
 *
 * The student picks a pattern (100 / 120 / 160 marks), the page assembles a
 * paper from the static MCQ bank, runs a JEE-style timed UI, then submits the
 * full per-question result to recordMockTest. That backend already:
 *   • inserts a mock_tests row
 *   • updates memory_atoms strength based on correct/incorrect + difficulty
 *   • upserts weak_topics for topics with > 50 % wrong rate
 *
 * Those tables are read by /api/chat on every tutor turn, so the AI's guidance
 * automatically biases toward the topics the student just got wrong here —
 * no extra prompt wiring needed.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { recordMockTest, generateDynamicPaper } from "@/lib/learning-os.functions";
import {
  PAPER_PATTERNS,
  type MCQ,
  type PaperPattern,
} from "@/lib/mock-test-bank";
import {
  Timer,
  ChevronLeft,
  ChevronRight,
  Flag,
  CheckCircle2,
  XCircle,
  Brain,
  ArrowLeft,
  Play,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/take-test")({
  head: () => ({ meta: [{ title: "Take a mock test · LAMA" }] }),
  component: TakeMockTestPage,
});

type Phase = "select" | "running" | "review" | "submitted";
type Answer = { selected?: "A" | "B" | "C" | "D"; flagged: boolean; timeSec: number };

function fmtTime(s: number) {
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const sec = Math.max(0, Math.floor(s % 60)).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function TakeMockTestPage() {
  // navigation handled via <Link>

  const [phase, setPhase] = useState<Phase>("select");
  const [patternKey, setPatternKey] = useState<keyof typeof PAPER_PATTERNS>("100");
  const [paper, setPaper] = useState<MCQ[]>([]);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [current, setCurrent] = useState(0);
  const [remainingSec, setRemainingSec] = useState(0);
  const [perQTimer, setPerQTimer] = useState(0);
  const [studentName, setStudentName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pattern = PAPER_PATTERNS[patternKey];

  // ── timer ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "running") return;
    tickRef.current = setInterval(() => {
      setRemainingSec((s) => {
        if (s <= 1) {
          clearInterval(tickRef.current!);
          handleSubmit(true);
          return 0;
        }
        return s - 1;
      });
      setPerQTimer((t) => t + 1);
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // commit the per-question timer whenever the student changes question
  const commitPerQTimer = (qId: string) => {
    setAnswers((a) => ({
      ...a,
      [qId]: {
        selected: a[qId]?.selected,
        flagged: a[qId]?.flagged ?? false,
        timeSec: (a[qId]?.timeSec ?? 0) + perQTimer,
      },
    }));
    setPerQTimer(0);
  };

  const startTest = async () => {
    setPhase("running");
    setLoadingQuestions(true); // Need to add this state if not present, or just let UI show blank briefly
    try {
      const p = await generateDynamicPaper({ data: { patternKey, weakTopics: [] } }); // Could fetch actual weak topics here
      setPaper(p);
      setAnswers({});
      setCurrent(0);
      setRemainingSec(pattern.durationMin * 60);
      setPerQTimer(0);
      setResult(null);
      setError(null);
    } catch (err) {
      setError("Failed to generate test");
      setPhase("select");
    } finally {
      setLoadingQuestions(false);
    }
  };

  const goto = (idx: number) => {
    if (!paper[current]) return;
    commitPerQTimer(paper[current].id);
    setCurrent(Math.max(0, Math.min(paper.length - 1, idx)));
  };

  const selectOption = (key: "A" | "B" | "C" | "D") => {
    const q = paper[current];
    setAnswers((a) => ({
      ...a,
      [q.id]: {
        selected: key,
        flagged: a[q.id]?.flagged ?? false,
        timeSec: a[q.id]?.timeSec ?? 0,
      },
    }));
  };

  const toggleFlag = () => {
    const q = paper[current];
    setAnswers((a) => ({
      ...a,
      [q.id]: {
        selected: a[q.id]?.selected,
        flagged: !(a[q.id]?.flagged ?? false),
        timeSec: a[q.id]?.timeSec ?? 0,
      },
    }));
  };

  const clearAnswer = () => {
    const q = paper[current];
    setAnswers((a) => ({
      ...a,
      [q.id]: {
        selected: undefined,
        flagged: a[q.id]?.flagged ?? false,
        timeSec: a[q.id]?.timeSec ?? 0,
      },
    }));
  };

  const computeStats = () => {
    let correct = 0;
    let wrong = 0;
    let unattempted = 0;
    for (const q of paper) {
      const a = answers[q.id];
      if (!a?.selected) unattempted++;
      else if (a.selected === q.correct) correct++;
      else wrong++;
    }
    const raw = correct * pattern.marksPerCorrect - wrong * pattern.negativeMarks;
    const rawMax = paper.length * pattern.marksPerCorrect;
    const pct = rawMax > 0 ? Math.max(0, Math.round((raw / rawMax) * 100)) : 0;
    return { correct, wrong, unattempted, raw, rawMax, pct };
  };

  const handleSubmit = async (auto = false) => {
    if (phase === "submitted") return;
    if (tickRef.current) clearInterval(tickRef.current);
    // commit any in-flight per-question time
    if (paper[current]) {
      const qId = paper[current].id;
      setAnswers((a) => ({
        ...a,
        [qId]: {
          selected: a[qId]?.selected,
          flagged: a[qId]?.flagged ?? false,
          timeSec: (a[qId]?.timeSec ?? 0) + perQTimer,
        },
      }));
      setPerQTimer(0);
    }

    setSubmitting(true);
    setError(null);

    // snapshot using latest answer state
    const snapshot = paper.map((q) => {
      const a = answers[q.id];
      const selected = (a?.selected ?? "") as string;
      return {
        subject: q.subject,
        topic: q.topic,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        correct: a?.selected === q.correct,
        timeTakenSec: a?.timeSec ?? 0,
        expectedTimeSec: q.expectedTimeSec,
        selectedOption: selected,
        correctOption: q.correct,
      };
    });

    const stats = computeStats();
    const durationUsed = Math.max(
      1,
      Math.round((pattern.durationMin * 60 - remainingSec) / 60),
    );

    // subject-wise raw scores
    const subjectScores: Record<string, number> = {};
    for (const q of paper) {
      const a = answers[q.id];
      const delta =
        a?.selected === q.correct
          ? pattern.marksPerCorrect
          : a?.selected
          ? -pattern.negativeMarks
          : 0;
      subjectScores[q.subject] = (subjectScores[q.subject] ?? 0) + delta;
    }

    try {
      const saved = await recordMockTest({
        data: {
          name:
            (studentName.trim() || "Mock test") +
            ` · ${pattern.totalMarks}M · ${new Date().toLocaleDateString()}`,
          testType: pattern.totalMarks === 160 ? "full" : "sectional",
          subjects: Object.keys(pattern.distribution),
          score: stats.pct,
          maxScore: 100, // recordMockTest stores percentage
          durationMin: durationUsed,
          subjectScores,
          weakTopics: [], // backend derives from per-question data
          notes: auto ? "Auto-submitted on timer expiry." : "Submitted by student.",
          questions: snapshot,
        },
      });
      setResult({ ...saved, stats });
      setPhase("submitted");
    } catch (e: any) {
      setError(e?.message ?? "Failed to submit test");
    } finally {
      setSubmitting(false);
    }
  };

  // ── render ──────────────────────────────────────────────────────────────
  if (phase === "select") {
    return (
      <Shell>
        <BackBar />
        <h1 className="text-3xl font-bold">Take a mock test</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Real exam-style paper. Timer, +{4}/−{1}, navigator panel, mark-for-review. After submission,
          every wrong answer is written into your memory atoms — your AI tutor sees the same weak topics on
          its next reply.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {Object.entries(PAPER_PATTERNS).map(([key, p]) => {
            const active = key === patternKey;
            return (
              <button
                key={key}
                onClick={() => setPatternKey(key as keyof typeof PAPER_PATTERNS)}
                className={`rounded-2xl border p-5 text-left transition ${
                  active
                    ? "border-primary bg-primary/10 ring-2 ring-primary/40"
                    : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {p.label}
                </div>
                <div className="mt-2 text-4xl font-bold">{p.totalMarks}<span className="text-base text-muted-foreground"> marks</span></div>
                <div className="mt-2 text-sm text-muted-foreground">{p.description}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <label className="block text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            Test label (optional)
          </label>
          <input
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="e.g. Pre-board #3"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          {error && <div className="mt-4 text-sm font-semibold text-rose-500">{error}</div>}
          <button
            onClick={startTest}
            disabled={loadingQuestions}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
          >
            {loadingQuestions ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-r-transparent" />
                Generating unique AI questions... (this may take a minute)
              </>
            ) : (
              <>
                <Play className="h-4 w-4" /> Start {pattern.totalMarks}-mark test ({pattern.durationMin} min)
              </>
            )}
          </button>
          <p className="mt-3 text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
            Once you click Start, the timer begins. Closing or refreshing the tab will lose progress.
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === "running") {
    const q = paper[current];
    const a = answers[q.id];
    const lowTime = remainingSec < 5 * 60;
    return (
      <Shell wide>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          {/* main question */}
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Question {current + 1} of {paper.length} · {q.subject} · {q.topic}
              </div>
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-mono ${
                  lowTime
                    ? "border-rose-700/40 bg-rose-900/30 text-rose-300 animate-pulse"
                    : "border-border bg-card text-foreground"
                }`}
              >
                <Timer className="h-4 w-4" />
                {fmtTime(remainingSec)}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="text-base leading-relaxed">{q.question}</div>
              <div className="mt-5 space-y-2">
                {q.options.map((opt) => {
                  const selected = a?.selected === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => selectOption(opt.key)}
                      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left text-sm transition ${
                        selected
                          ? "border-primary bg-primary/15"
                          : "border-border bg-background hover:border-primary/40"
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {opt.key}
                      </span>
                      <span>{opt.text}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  onClick={() => goto(current - 1)}
                  disabled={current === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </button>
                <button
                  onClick={() => goto(current + 1)}
                  disabled={current === paper.length - 1}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={toggleFlag}
                  className={`inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs ${
                    a?.flagged
                      ? "border-amber-700/50 bg-amber-900/30 text-amber-300"
                      : "border-border bg-background"
                  }`}
                >
                  <Flag className="h-3.5 w-3.5" /> {a?.flagged ? "Unmark" : "Mark for review"}
                </button>
                <button
                  onClick={clearAnswer}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
                >
                  Clear response
                </button>
                <div className="ml-auto" />
                <button
                  onClick={() => setPhase("review")}
                  className="rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Submit test
                </button>
              </div>
            </div>
          </div>

          {/* navigator */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Question navigator
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {paper.map((qq, i) => {
                const ans = answers[qq.id];
                const cls = ans?.flagged
                  ? "bg-amber-700/60 text-amber-50"
                  : ans?.selected
                  ? "bg-emerald-700/60 text-emerald-50"
                  : "bg-muted text-muted-foreground";
                const active = i === current ? "ring-2 ring-primary" : "";
                return (
                  <button
                    key={qq.id}
                    onClick={() => goto(i)}
                    className={`h-8 rounded-md text-xs font-semibold ${cls} ${active}`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 space-y-1.5 text-[11px] text-muted-foreground">
              <Legend swatch="bg-emerald-700/60" label="Answered" />
              <Legend swatch="bg-amber-700/60" label="Marked for review" />
              <Legend swatch="bg-muted" label="Not visited / blank" />
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  if (phase === "review") {
    const stats = computeStats();
    return (
      <Shell>
        <BackBar />
        <h1 className="text-2xl font-bold">Submit test?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You answered {stats.correct + stats.wrong} of {paper.length} questions.
          {stats.unattempted > 0 && ` ${stats.unattempted} unattempted.`}
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <Stat label="Attempted" value={`${stats.correct + stats.wrong}`} />
          <Stat label="Predicted score" value={`${stats.raw} / ${stats.rawMax}`} />
          <Stat label="Percentage" value={`${stats.pct}%`} />
          <Stat label="Time used" value={fmtTime(pattern.durationMin * 60 - remainingSec)} />
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            onClick={() => setPhase("running")}
            className="rounded-md border border-border bg-background px-4 py-2 text-sm"
          >
            Back to test
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={submitting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Confirm submit"}
          </button>
        </div>
      </Shell>
    );
  }

  // phase === "submitted"
  const stats = result?.stats;
  const wrongQs = paper
    .map((q) => ({ q, a: answers[q.id] }))
    .filter((x) => x.a?.selected && x.a.selected !== x.q.correct);
  const unattemptedQs = paper.filter((q) => !answers[q.id]?.selected);

  // weak-topic aggregation for the post-test summary
  const topicAgg: Record<string, { wrong: number; total: number; subject: string }> = {};
  for (const q of paper) {
    const k = `${q.subject} · ${q.topic}`;
    topicAgg[k] = topicAgg[k] || { wrong: 0, total: 0, subject: q.subject };
    topicAgg[k].total++;
    if (answers[q.id]?.selected && answers[q.id]!.selected !== q.correct) topicAgg[k].wrong++;
  }
  const weakRanked = Object.entries(topicAgg)
    .filter(([, v]) => v.wrong > 0)
    .sort((a, b) => b[1].wrong / b[1].total - a[1].wrong / a[1].total)
    .slice(0, 6);

  return (
    <Shell>
      <BackBar />
      <h1 className="text-3xl font-bold">Test submitted</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your answers have been scored and the topics you missed have been written into your memory atoms.
        Your AI tutor will see these on its very next message.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Score" value={`${stats.raw} / ${stats.rawMax}`} highlight />
        <Stat label="Percentage" value={`${stats.pct}%`} highlight />
        <Stat label="Correct" value={stats.correct} />
        <Stat label="Wrong" value={stats.wrong} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Brain className="h-4 w-4 text-amber-400" /> Topics flagged as weak
          </div>
          {weakRanked.length === 0 ? (
            <div className="text-sm text-muted-foreground">No topics flagged — clean run.</div>
          ) : (
            <ul className="space-y-2">
              {weakRanked.map(([name, v]) => {
                const pct = Math.round((v.wrong / v.total) * 100);
                return (
                  <li
                    key={name}
                    className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm"
                  >
                    <span>{name}</span>
                    <span className="rounded-full bg-rose-900/40 px-2 py-0.5 text-[11px] text-rose-300">
                      {v.wrong}/{v.total} wrong · {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            These are now in <code className="rounded bg-muted px-1">weak_topics</code> and the affected
            memory atoms have had their strength reduced. Open a chat and the tutor will lead with them.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <XCircle className="h-4 w-4 text-rose-400" /> Wrong answers ({wrongQs.length})
          </div>
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {wrongQs.map(({ q, a }) => (
              <div key={q.id} className="rounded-md border border-border bg-background p-3 text-xs">
                <div className="text-muted-foreground">{q.subject} · {q.topic}</div>
                <div className="mt-1 text-sm">{q.question}</div>
                <div className="mt-2">
                  <span className="text-rose-400">Your answer: {a?.selected}</span> ·{" "}
                  <span className="text-emerald-400">Correct: {q.correct}</span>
                </div>
                <div className="mt-1 text-muted-foreground">{q.explanation}</div>
              </div>
            ))}
            {unattemptedQs.length > 0 && (
              <div className="text-xs text-muted-foreground">
                + {unattemptedQs.length} unattempted question{unattemptedQs.length === 1 ? "" : "s"}.
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-8 flex flex-wrap gap-2">
        <Link
          to="/me/mock-tests"
          className="rounded-md border border-border bg-background px-4 py-2 text-sm"
        >
          View test history
        </Link>
        <Link
          to="/chat"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Ask the tutor about a weak topic
        </Link>
        <button
          onClick={() => {
            setPhase("select");
            setResult(null);
            setPaper([]);
            setAnswers({});
          }}
          className="rounded-md border border-border bg-background px-4 py-2 text-sm"
        >
          Take another test
        </button>
      </div>
    </Shell>
  );
}

// ── primitives ───────────────────────────────────────────────────────────
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className={`mx-auto px-4 py-8 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>{children}</div>
    </div>
  );
}

function BackBar() {
  return (
    <Link
      to="/me/mock-tests"
      className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back to mock tests
    </Link>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: any; highlight?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight ? "border-primary/40 bg-primary/10" : "border-border bg-card"
      }`}
    >
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-3 w-3 rounded ${swatch}`} />
      <span>{label}</span>
    </div>
  );
}
