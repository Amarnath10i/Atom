// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { adminLogin, adminOverview } from "@/lib/admin.functions";
import { TopBar } from "@/components/TopBar";
import { Shield, Users, MessageSquare, Brain, AlertTriangle, ListChecks, LogOut, Activity } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin · LAMA" },
      { name: "description", content: "Admin dashboard — monitor students, sessions, agent runs and safety events." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AdminPage,
});

const STORAGE_KEY = "lama_admin_pw";

function AdminPage() {
  const [password, setPassword] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof adminOverview>> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) setPassword(saved);
  }, []);

  const login = useMutation({
    mutationFn: (pw: string) => adminLogin({ data: { password: pw } }),
    onSuccess: (_, pw) => {
      sessionStorage.setItem(STORAGE_KEY, pw);
      setPassword(pw);
      toast.success("Signed in as admin");
    },
    onError: (e: Error) => toast.error(e.message ?? "Invalid password"),
  });

  const loadOverview = useMutation({
    mutationFn: (pw: string) => adminOverview({ data: { password: pw } }),
    onSuccess: (res) => setData(res),
    onError: (e: Error) => {
      toast.error(e.message ?? "Failed to load");
      if (/invalid/i.test(e.message)) {
        sessionStorage.removeItem(STORAGE_KEY);
        setPassword(null);
      }
    },
  });

  useEffect(() => {
    if (password) loadOverview.mutate(password);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  function logout() {
    sessionStorage.removeItem(STORAGE_KEY);
    setPassword(null);
    setData(null);
  }

  if (!password) {
    return (
      <>
        <TopBar />
        <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6">
          <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">Admin sign-in</h1>
            </div>
            <p className="mb-6 text-sm text-muted-foreground">
              Enter the admin password to monitor students, sessions and agent activity.
              Default is <code className="rounded bg-muted px-1.5 py-0.5">admin123</code> —
              override with the <code>ADMIN_PASSWORD</code> env var.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) login.mutate(input.trim());
              }}
              className="space-y-3"
            >
              <input
                type="password"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Admin password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
              />
              <button
                type="submit"
                disabled={login.isPending}
                className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                {login.isPending ? "Checking…" : "Sign in"}
              </button>
              <Link to="/" className="block text-center text-xs text-muted-foreground hover:underline">
                Back to home
              </Link>
            </form>
          </div>
        </div>
      </>
    );
  }

  const t = data?.totals;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Shield className="h-4 w-4" /> Admin dashboard
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Platform overview</h1>
            <p className="text-sm text-muted-foreground">
              Aggregate metrics across every student using LAMA.
            </p>
          </div>
          <button
            onClick={logout}
            className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        {!data ? (
          <div className="rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
            Loading dashboard…
          </div>
        ) : (
          <div className="space-y-8">
            {/* KPIs */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi icon={Users} label="Students" value={t?.students ?? 0} />
              <Kpi icon={MessageSquare} label="Sessions" value={t?.threads ?? 0} />
              <Kpi icon={Activity} label="Messages (last 500)" value={t?.messages ?? 0} />
              <Kpi icon={Brain} label="Memory atoms" value={t?.atoms ?? 0} />
              <Kpi icon={AlertTriangle} label="Weak topics flagged" value={t?.weakTopics ?? 0} />
              <Kpi icon={ListChecks} label="Plan items" value={t?.planItems ?? 0} />
            </div>

            {/* Students table */}
            <section className="rounded-xl border border-border bg-card">
              <header className="border-b border-border px-5 py-3">
                <h2 className="text-base font-semibold">Students</h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Exam</th>
                      <th className="px-4 py-2.5 text-right">Sessions</th>
                      <th className="px-4 py-2.5 text-right">Messages</th>
                      <th className="px-4 py-2.5 text-right">Atoms</th>
                      <th className="px-4 py-2.5 text-right">Avg strength</th>
                      <th className="px-4 py-2.5 text-right">Weak topics</th>
                      <th className="px-4 py-2.5 text-right">Plan progress</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((s) => (
                      <tr key={s.id} className="border-t border-border/60">
                        <td className="px-4 py-2.5 font-medium">{s.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{s.exam ?? "—"}</td>
                        <td className="px-4 py-2.5 text-right">{s.stats?.threads ?? 0}</td>
                        <td className="px-4 py-2.5 text-right">{s.stats?.messages ?? 0}</td>
                        <td className="px-4 py-2.5 text-right">{s.stats?.atoms ?? 0}</td>
                        <td className="px-4 py-2.5 text-right">
                          {s.stats ? (s.stats.avgStrength * 100).toFixed(0) + "%" : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">{s.stats?.weakTopics ?? 0}</td>
                        <td className="px-4 py-2.5 text-right">
                          {s.stats?.planItems
                            ? `${s.stats.planDone}/${s.stats.planItems}`
                            : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            to="/student/$studentId"
                            params={{ studentId: s.id }}
                            className="text-primary hover:underline"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {data.students.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                          No students yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Two-column: weak topics + reflections */}
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-card">
                <header className="border-b border-border px-5 py-3">
                  <h2 className="text-base font-semibold">Top weak topics</h2>
                </header>
                <ul className="divide-y divide-border/60">
                  {data.topWeakTopics.length === 0 && (
                    <li className="px-5 py-4 text-sm text-muted-foreground">No weak topics flagged.</li>
                  )}
                  {data.topWeakTopics.map((w) => (
                    <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span>
                        <span className="font-medium">{w.topic}</span>
                        {w.subject && <span className="ml-2 text-xs text-muted-foreground">{w.subject}</span>}
                      </span>
                      <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        {Math.round(Number(w.severity ?? 0) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-xl border border-border bg-card">
                <header className="border-b border-border px-5 py-3">
                  <h2 className="text-base font-semibold">Recent reflections</h2>
                </header>
                <ul className="divide-y divide-border/60">
                  {data.recentReflections.length === 0 && (
                    <li className="px-5 py-4 text-sm text-muted-foreground">No reflections yet.</li>
                  )}
                  {data.recentReflections.slice(0, 10).map((r) => (
                    <li key={r.id} className="px-5 py-3 text-sm">
                      <p className="line-clamp-2">{r.summary}</p>
                      {r.next_focus && (
                        <p className="mt-1 text-xs text-muted-foreground">Next: {r.next_focus}</p>
                      )}
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

          </div>
        )}
      </main>
    </>
  );
}


function Kpi({ icon: Icon, label, value }: { icon: typeof Shield; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

function LogPanel({ title, rows, empty }: { title: string; rows: unknown[]; empty: string }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
      </header>
      <div className="max-h-80 overflow-auto">
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border/60 font-mono text-xs">
            {rows.map((row, i) => (
              <li key={i} className="px-5 py-2 break-all">
                {JSON.stringify(row)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
