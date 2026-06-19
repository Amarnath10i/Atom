// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getLearnerModel } from "@/lib/learning-os.functions";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import { Brain, Zap, TrendingUp, AlertTriangle, BookOpen, RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/me/learner")({
  head: () => ({
    meta: [{ title: "Learner Model · LAMA" }],
  }),
  component: LearnerModelPage,
});

function LearnerModelPage() {
  const [model, setModel] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const m = await getLearnerModel();
      setModel(m);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load learner model");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <Shell><div className="py-24 text-center text-muted-foreground animate-pulse">Constructing your learner model…</div></Shell>;
  if (err)     return <Shell><div className="py-12 text-destructive">{err}</div></Shell>;
  if (!model)  return <Shell><div className="py-12 text-muted-foreground">No learner data found. Start chatting to build your model.</div></Shell>;

  const { student, metrics, subjectScores, topReviewed, atRisk, learningStyle, recentReflections } = model;

  const radarData = subjectScores.map((s: any) => ({
    subject: s.subject,
    strength: parseFloat((s.avgStrength * 100).toFixed(1)),
    fullMark: 100,
  }));

  const gradeColor = (score: number) =>
    score >= 75 ? "#22c55e" : score >= 55 ? "#eab308" : "#ef4444";

  const predictedGrade =
    metrics.predictedScore >= 90 ? "A+" :
    metrics.predictedScore >= 80 ? "A" :
    metrics.predictedScore >= 70 ? "B" :
    metrics.predictedScore >= 55 ? "C" :
    metrics.predictedScore >= 40 ? "D" : "F";

  return (
    <Shell>
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
            <Brain className="h-3.5 w-3.5" /> Phase 1 · Learner Model
          </div>
          <h1 className="text-3xl font-bold">Personal Learning Twin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {student.name} · {student.exam} · Grade {student.grade}
          </p>
        </div>
        <button onClick={load} className="rounded-full border border-border p-2 hover:bg-muted transition">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Top KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KPICard
          label="Predicted score"
          value={<span style={{ color: gradeColor(metrics.predictedScore) }}>{metrics.predictedScore}%</span>}
          sub={`Grade ${predictedGrade}`}
          icon={TrendingUp}
        />
        <KPICard label="Atoms learned" value={metrics.totalAtoms} sub={`${metrics.totalBonds} bonds`} icon={BookOpen} />
        <KPICard
          label="Retention rate"
          value={`${(metrics.retentionRate * 100).toFixed(0)}%`}
          sub={`${(metrics.avgStrength * 100).toFixed(0)}% avg strength`}
          icon={Brain}
        />
        <KPICard
          label="Learning velocity"
          value={`${metrics.learningVelocity}`}
          sub="atoms / day"
          icon={Zap}
        />
      </div>

      {/* Learning style + streak */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-1 font-semibold text-sm text-muted-foreground uppercase tracking-wide">Inferred Learning Style</h3>
          <div className="mt-3">
            <div className="text-xl font-bold">{learningStyle.style}</div>
            <p className="mt-1 text-sm text-muted-foreground">{learningStyle.description}</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-1 font-semibold text-sm text-muted-foreground uppercase tracking-wide">Study Streak</h3>
          <div className="mt-3">
            <div className="text-4xl font-bold text-primary">{metrics.studyStreak}</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {metrics.studyStreak === 0 ? "No sessions recorded yet." :
               metrics.studyStreak === 1 ? "consecutive day" :
               "consecutive days"}
            </p>
          </div>
        </div>
      </div>

      {/* Radar + subject bars */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 font-semibold">Subject mastery radar</h3>
          {radarData.length < 3 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">Need atoms in at least 3 subjects.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#1f2937" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#9ca3af", fontSize: 11 }} />
                <Radar name="Strength" dataKey="strength" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.25} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-4 font-semibold">Subject atom distribution</h3>
          {subjectScores.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No atoms yet.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={subjectScores} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} />
                <YAxis type="category" dataKey="subject" tick={{ fill: "#9ca3af", fontSize: 11 }} width={80} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #1f2937", borderRadius: 8 }}
                  formatter={(v: number, name: string) => [v, name === "atomCount" ? "Atoms" : "Avg strength"]}
                />
                <Bar dataKey="atomCount" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                  {subjectScores.map((_: any, i: number) => (
                    <Cell key={i} fill="#3b82f6" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top reviewed + at risk */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 font-semibold">Most practised topics</h3>
          {topReviewed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ol className="space-y-2">
              {topReviewed.map((t: any, i: number) => (
                <li key={t.topic} className="flex items-center gap-3 rounded-lg border border-border/60 p-2 text-sm">
                  <span className="text-xs font-bold text-muted-foreground w-4">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{t.topic}</div>
                    <div className="text-xs text-muted-foreground">{t.subject}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold text-muted-foreground">{t.reviews}×</div>
                    <div className="text-xs" style={{ color: t.strength > 0.6 ? "#22c55e" : "#ef4444" }}>
                      {(t.strength * 100).toFixed(0)}%
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-2xl border border-amber-700/50 bg-amber-950/20 p-5">
          <h3 className="mb-3 font-semibold flex items-center gap-2 text-amber-300">
            <AlertTriangle className="h-4 w-4" /> At-risk topics
          </h3>
          {atRisk.length === 0 ? (
            <p className="text-sm text-muted-foreground">All atoms are healthy. Keep it up!</p>
          ) : (
            <ul className="space-y-2">
              {atRisk.map((t: any) => (
                <li key={t.topic} className="flex items-center justify-between gap-3 rounded-lg border border-amber-700/30 bg-amber-900/10 p-2 text-sm">
                  <div>
                    <div className="font-medium">{t.topic}</div>
                    <div className="text-xs text-muted-foreground">{t.subject} · {t.daysSinceReview}d since review</div>
                  </div>
                  <span className="text-xs font-bold text-rose-400">{(t.strength * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent reflections */}
      {recentReflections?.length > 0 && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 font-semibold">Recent reflections</h3>
          <div className="space-y-3">
            {recentReflections.map((r: any) => (
              <div key={r.id} className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm">
                <div className="text-xs text-muted-foreground mb-1">{new Date(r.created_at).toLocaleDateString()}</div>
                <p>{r.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

function KPICard({ label, value, sub, icon: Icon }: { label: string; value: React.ReactNode; sub: string; icon: any }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-6 py-12 md:py-16">{children}</div>;
}
