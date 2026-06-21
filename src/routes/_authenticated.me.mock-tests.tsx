// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { recordMockTest, getMockTests } from "@/lib/learning-os.functions";
import { Target, RefreshCw, PlusCircle, TrendingUp, Trophy, Plus, Trash2, ChevronDown, ChevronUp, Zap, Brain, Clock, Play } from "lucide-react";


export const Route = createFileRoute("/_authenticated/me/mock-tests")({
  head: () => ({ meta: [{ title: "Mock Tests · LAMA" }] }),
  component: MockTestsPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

type TestType = "full" | "sectional" | "chapter" | "previous_year";

interface QuestionEntry {
  id: string;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: number;
  correct: boolean;
  timeTakenSec: number;
  expectedTimeSec: number;
  selectedOption: string;
  correctOption: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

function scoreColor(pct: number) {
  if (pct >= 75) return "text-emerald-400";
  if (pct >= 50) return "text-yellow-400";
  if (pct >= 30) return "text-orange-400";
  return "text-rose-400";
}

function deltaTag(delta: number) {
  const abs = Math.abs(delta * 100).toFixed(0);
  if (delta > 0.01) return <span className="rounded-full bg-emerald-900/40 border border-emerald-700/40 px-2 py-0.5 text-[10px] text-emerald-300">+{abs}% atom</span>;
  if (delta < -0.01) return <span className="rounded-full bg-rose-900/40 border border-rose-700/40 px-2 py-0.5 text-[10px] text-rose-300">{-abs > 0 ? '+' : ''}{(delta * 100).toFixed(0)}% atom</span>;
  return null;
}

function blankQuestion(): QuestionEntry {
  return { id: uid(), subject: "", topic: "", subtopic: "", difficulty: 3, correct: false, timeTakenSec: 0, expectedTimeSec: 120, selectedOption: "", correctOption: "" };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function MockTestsPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [testType, setTestType] = useState<TestType>("full");
  const [score, setScore] = useState<number>(0);
  const [maxScore, setMaxScore] = useState<number>(360);
  const [durationMin, setDurationMin] = useState<number>(180);
  const [subjects, setSubjects] = useState<string>("Physics, Chemistry, Mathematics");
  const [notes, setNotes] = useState("");
  const [questions, setQuestions] = useState<QuestionEntry[]>([]);
  const [questionMode, setQuestionMode] = useState<"none" | "questions">("none");

  const load = async () => {
    setLoading(true); setErr(null);
    try { setData(await getMockTests()); }
    catch (e: any) { setErr(e?.message ?? "Failed to load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  // ── question helpers ──────────────────────────────────────────────────────
  const addQuestion = () => setQuestions((q) => [...q, blankQuestion()]);
  const removeQuestion = (id: string) => setQuestions((q) => q.filter((x) => x.id !== id));
  const updateQuestion = (id: string, patch: Partial<QuestionEntry>) =>
    setQuestions((q) => q.map((x) => x.id === id ? { ...x, ...patch } : x));

  // ── submit ────────────────────────────────────────────────────────────────
  const submit = async () => {
    if (!name.trim()) { setErr("Give the test a name."); return; }
    setSaving(true); setErr(null);
    try {
      await recordMockTest({
        data: {
          name: name.trim(),
          testType,
          subjects: subjects.split(",").map((s) => s.trim()).filter(Boolean),
          score,
          maxScore,
          durationMin,
          subjectScores: {},
          weakTopics: [],   // auto-derived from questions now
          notes,
          questions: questionMode === "questions" ? questions : [],
        },
      });
      setShowForm(false);
      setName(""); setNotes(""); setScore(0); setQuestions([]); setQuestionMode("none");
      await load();
    } catch (e: any) { setErr(e?.message ?? "Failed to save"); }
    finally { setSaving(false); }
  };

  if (loading) return <Shell><div className="py-24 text-center text-muted-foreground animate-pulse">Loading mock tests…</div></Shell>;

  const tests = data?.tests ?? [];
  const trend = data?.trend ?? [];
  const avgScore = data?.avgScore ?? 0;
  const best = data?.best ?? null;

  // sparkline
  const W = 600, H = 140;
  const points = trend.map((t: any, i: number) => {
    const x = trend.length > 1 ? (i / (trend.length - 1)) * (W - 40) + 20 : W / 2;
    const y = H - 20 - (t.score / 100) * (H - 40);
    return { x, y, ...t };
  });
  const path = points.map((p: any, i: number) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(" ");

  const wrongCount = questions.filter((q) => !q.correct).length;
  const rightCount = questions.filter((q) => q.correct).length;

  return (
    <Shell>
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            <Target className="h-3.5 w-3.5" /> Phase 4 · Mock Tests
          </div>
          <h1 className="text-3xl font-bold">Mock test tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tests.length} test{tests.length === 1 ? "" : "s"} logged · avg {avgScore}% · wrong answers update your memory atoms directly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="rounded-full border border-border p-1.5 text-muted-foreground hover:text-foreground transition" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <Link
            to="/me/take-test"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            <Play className="h-3.5 w-3.5" /> Take a real mock test
          </Link>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <PlusCircle className="h-3.5 w-3.5" /> Log mock test
          </button>
        </div>

      </div>

      {err && <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>}

      {/* How it works banner */}
      <div className="mb-6 rounded-2xl border border-blue-800/30 bg-blue-950/20 p-4 text-sm text-blue-200">
        <div className="font-semibold text-blue-300 mb-1 flex items-center gap-2"><Zap className="h-3.5 w-3.5" /> Question-level diagnostics</div>
        Log individual questions with their topics to automatically update your memory atoms — wrong answers lower atom strength, correct answers reinforce it. Repeated wrong options on the same topic are flagged as misconceptions.
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card label="Average score" value={`${avgScore}%`} icon={<TrendingUp className="h-4 w-4" />} valueClass={scoreColor(avgScore)} />
        <Card label="Best score" value={best ? `${best.score}%` : "—"} icon={<Trophy className="h-4 w-4" />} valueClass={best ? scoreColor(best.score) : ""} sub={best?.name} />
        <Card label="Tests logged" value={tests.length.toString()} icon={<Target className="h-4 w-4" />} />
      </div>

      {/* Log form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-5 space-y-5">
          <h3 className="font-semibold text-lg">New mock test</h3>

          {/* Basic info */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Test name">
              <input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="JEE Main Mock #4" />
            </Field>
            <Field label="Type">
              <select className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={testType} onChange={(e) => setTestType(e.target.value as TestType)}>
                <option value="full">Full-length</option>
                <option value="sectional">Sectional</option>
                <option value="chapter">Chapter test</option>
                <option value="previous_year">Previous year</option>
              </select>
            </Field>
            <Field label="Score">
              <input type="number" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={score} onChange={(e) => setScore(Number(e.target.value))} />
            </Field>
            <Field label="Max score">
              <input type="number" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} />
            </Field>
            <Field label="Duration (min)">
              <input type="number" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
            </Field>
            <Field label="Subjects (comma-separated)">
              <input className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={subjects} onChange={(e) => setSubjects(e.target.value)} />
            </Field>
            <Field label="Notes" full>
              <textarea className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          {/* Question mode toggle */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Diagnostic questions</div>
            <div className="flex gap-2">
              {(["none", "questions"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setQuestionMode(m); if (m === "questions" && questions.length === 0) addQuestion(); }}
                  className={`rounded-xl border px-3 py-2 text-sm transition ${questionMode === m ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-foreground/30"}`}
                >
                  {m === "none" ? "Score only — no question breakdown" : "Log individual questions (updates atoms)"}
                </button>
              ))}
            </div>
          </div>

          {/* Per-question entry */}
          {questionMode === "questions" && (
            <div className="space-y-3">
              {/* Mini stat bar */}
              {questions.length > 0 && (
                <div className="flex items-center gap-4 text-xs text-muted-foreground rounded-xl border border-border bg-muted/20 p-3">
                  <span>{questions.length} questions</span>
                  <span className="text-emerald-400">{rightCount} correct</span>
                  <span className="text-rose-400">{wrongCount} wrong</span>
                  {questions.length > 0 && <span className="ml-auto">{((rightCount / questions.length) * 100).toFixed(0)}% accuracy</span>}
                </div>
              )}

              {questions.map((q, idx) => (
                <div key={q.id} className={`rounded-xl border p-3 space-y-2 ${q.correct ? "border-emerald-800/40 bg-emerald-950/10" : "border-rose-800/40 bg-rose-950/10"}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Q{idx + 1}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuestion(q.id, { correct: !q.correct })}
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition ${q.correct ? "bg-emerald-700/30 text-emerald-300 border border-emerald-700/50" : "bg-rose-700/30 text-rose-300 border border-rose-700/50"}`}
                      >
                        {q.correct ? "✓ Correct" : "✗ Wrong"}
                      </button>
                      <button onClick={() => removeQuestion(q.id)} className="text-muted-foreground hover:text-destructive transition">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                      placeholder="Subject (e.g. Physics)"
                      value={q.subject}
                      onChange={(e) => updateQuestion(q.id, { subject: e.target.value })}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                      placeholder="Topic (e.g. Kinematics)"
                      value={q.topic}
                      onChange={(e) => updateQuestion(q.id, { topic: e.target.value })}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
                      placeholder="Subtopic (optional)"
                      value={q.subtopic}
                      onChange={(e) => updateQuestion(q.id, { subtopic: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <label className="text-[10px] text-muted-foreground">
                      Difficulty
                      <select
                        className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                        value={q.difficulty}
                        onChange={(e) => updateQuestion(q.id, { difficulty: Number(e.target.value) })}
                      >
                        {[1,2,3,4,5].map((d) => <option key={d} value={d}>{d} {["","(Easy)","","","","(Hard)"][d]}</option>)}
                      </select>
                    </label>
                    <label className="text-[10px] text-muted-foreground">
                      Time taken (sec)
                      <input type="number" className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={q.timeTakenSec} onChange={(e) => updateQuestion(q.id, { timeTakenSec: Number(e.target.value) })} />
                    </label>
                    {!q.correct && (
                      <>
                        <label className="text-[10px] text-muted-foreground">
                          Selected option
                          <input className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs uppercase" placeholder="A / B / C / D" maxLength={1} value={q.selectedOption} onChange={(e) => updateQuestion(q.id, { selectedOption: e.target.value.toUpperCase() })} />
                        </label>
                        <label className="text-[10px] text-muted-foreground">
                          Correct option
                          <input className="mt-0.5 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs uppercase" placeholder="A / B / C / D" maxLength={1} value={q.correctOption} onChange={(e) => updateQuestion(q.id, { correctOption: e.target.value.toUpperCase() })} />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ))}

              <button
                onClick={addQuestion}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground transition w-full justify-center"
              >
                <Plus className="h-3.5 w-3.5" /> Add question
              </button>

              {/* What will happen explainer */}
              {wrongCount > 0 && (
                <div className="rounded-xl border border-amber-800/30 bg-amber-950/15 p-3 text-xs text-amber-200 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5"><Brain className="h-3 w-3" /> What saving will do to your atom graph</div>
                  <div>— {wrongCount} wrong-answer topic{wrongCount > 1 ? "s" : ""} will have atom strength reduced (−8% to −18% based on difficulty)</div>
                  <div>— These topics will be added or escalated in your weak topics list</div>
                  {questions.some((q) => !q.correct && q.selectedOption) && <div>— Repeated wrong option choices will be flagged as misconceptions</div>}
                  <div>— {rightCount} correct-answer topic{rightCount > 1 ? "s" : ""} will receive small strength boost (+5%)</div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowForm(false)} className="rounded-md border border-border px-3 py-1.5 text-sm">Cancel</button>
            <button onClick={submit} disabled={saving} className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {saving ? "Saving…" : "Save test"}
            </button>
          </div>
        </div>
      )}

      {/* Trend chart */}
      {trend.length > 1 && (
        <div className="mb-6 rounded-2xl border border-border bg-card/40 p-5">
          <h3 className="text-sm font-semibold mb-3">Score trend</h3>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 180 }}>
            <line x1={20} y1={H - 20} x2={W - 20} y2={H - 20} stroke="#374151" strokeWidth={1} />
            <path d={path} fill="none" stroke="#3b82f6" strokeWidth={2} />
            {points.map((p: any, i: number) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={4} fill="#3b82f6" />
                <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={9} fill="#9ca3af">{p.score}%</text>
              </g>
            ))}
          </svg>
        </div>
      )}

      {/* Test list */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {tests.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No mock tests yet. Log one to start tracking outcomes.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {tests.map((t: any) => {
              const pct = (t.score / Math.max(1, t.max_score)) * 100;
              const isOpen = expandedTest === t.id;
              return (
                <li key={t.id}>
                  <button
                    className="w-full p-4 flex flex-wrap items-center gap-4 text-left hover:bg-muted/20 transition"
                    onClick={() => setExpandedTest(isOpen ? null : t.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold flex items-center gap-2">
                        {t.name}
                        {t.atomsUpdated && <span className="rounded-full bg-blue-900/30 border border-blue-700/40 px-2 py-0.5 text-[10px] text-blue-300 flex items-center gap-1"><Zap className="h-2.5 w-2.5" />atoms updated</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t.test_type?.replace("_", " ")} · {new Date(t.taken_at).toLocaleDateString()} · {t.duration_min} min
                        {t.subjects?.length > 0 && ` · ${t.subjects.join(", ")}`}
                      </div>
                      {t.weak_topics?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.weak_topics.map((w: string) => (
                            <span key={w} className="rounded-full border border-rose-700/40 bg-rose-950/20 px-2 py-0.5 text-[10px] text-rose-300">{w}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`text-right ${scoreColor(pct)}`}>
                        <div className="text-2xl font-bold leading-none">{t.score}<span className="text-sm text-muted-foreground">/{t.max_score}</span></div>
                        <div className="text-xs mt-0.5 opacity-70">{pct.toFixed(1)}%</div>
                      </div>
                      {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {isOpen && t.notes && (
                    <div className="px-4 pb-4 text-sm text-muted-foreground border-t border-border/40 pt-3">
                      <div className="text-xs font-semibold uppercase tracking-wide mb-1">Notes</div>
                      {t.notes}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Shell>
  );
}

// ─── Small components ─────────────────────────────────────────────────────────

function Card({ label, value, sub, icon, valueClass = "" }: any) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

function Field({ label, children, full }: any) {
  return (
    <label className={`block text-sm ${full ? "sm:col-span-2" : ""}`}>
      <span className="block text-xs font-medium text-muted-foreground mb-1">{label}</span>
      {children}
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">{children}</div>;
}
