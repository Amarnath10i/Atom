import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Network, Shield, LogOut, Menu, X,
  Plus, MessageSquare, Loader2, ChevronLeft, ChevronRight,
  Map, GitBranch, TrendingDown, Brain, FlaskConical, Sparkles,
  Target, ChevronDown,
} from "lucide-react";
import { AtomWordmark } from "@/components/AtomMark";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { getMe } from "@/lib/auth.functions";
import { getDashboard, createThread } from "@/lib/tutor.functions";

type Thread = { id: string; title: string; updated_at: string };

const PHASE_SECTIONS = [
  {
    label: "Phase 4",
    color: "text-fuchsia-400",
    dot: "bg-fuchsia-500",
    links: [
      { to: "/me/mock-tests", icon: Target, label: "Mock Tests" },
    ],
  },
  {
    label: "Phase 3",
    color: "text-rose-400",
    dot: "bg-rose-500",
    links: [
      { to: "/me/counterfactual",  icon: GitBranch, label: "Counterfactual" },
      { to: "/me/exam-strategy",   icon: Target,    label: "Exam Strategy" },
    ],
  },
  {
    label: "Phase 2",
    color: "text-amber-400",
    dot: "bg-amber-500",
    links: [
      { to: "/me/simulator", icon: FlaskConical, label: "Simulator" },
      { to: "/me/critic",    icon: Sparkles,     label: "Enhanced Critic" },
    ],
  },
  {
    label: "Phase 1",
    color: "text-emerald-400",
    dot: "bg-emerald-500",
    links: [
      { to: "/me/curriculum", icon: GitBranch,   label: "Curriculum" },
      { to: "/me/progress",   icon: TrendingDown, label: "Forgetting Curves" },
      { to: "/me/learner",    icon: Brain,        label: "Learner Model" },
    ],
  },
] as const;

export function AppSidebar() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("lama:sidebar:collapsed") === "1";
  });
  const [phasesOpen, setPhasesOpen] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lama:sidebar:collapsed", collapsed ? "1" : "0");
      document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
    }
  }, [collapsed]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [creating, setCreating] = useState(false);

  const activeThreadId = (() => {
    const m = pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  })();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (cancelled) return;
        setIsAdmin(me.roles.includes("admin"));
        if (me.student) {
          setStudentId(me.student.id);
          const dash = await getDashboard({ data: { studentId: me.student.id } });
          if (!cancelled) setThreads((dash.threads ?? []) as Thread[]);
        }
      } catch { /* not signed in */ } finally {
        if (!cancelled) setLoadingThreads(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pathname]);

  async function handleNewChat() {
    if (!studentId || creating) return;
    setCreating(true);
    try {
      const t = await createThread({ data: { studentId } });
      setThreads((prev) => [{ id: t.id, title: t.title, updated_at: t.updated_at }, ...prev]);
      setOpen(false);
      navigate({ to: "/chat/$threadId", params: { threadId: t.id } });
    } finally { setCreating(false); }
  }

  async function signOut() {
    await qc.cancelQueries(); qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function navCls(path: string) {
    const active = pathname.startsWith(path);
    return `flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition ${
      active ? "bg-primary/15 text-foreground font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground"
    }`;
  }

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="fixed left-3 top-3 z-50 inline-flex items-center justify-center rounded-md border border-border bg-card p-2 shadow md:hidden"
        aria-label="Toggle navigation">
        {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
      </button>

      {collapsed && (
        <button type="button" onClick={() => setCollapsed(false)}
          className="fixed left-3 top-3 z-50 hidden md:inline-flex items-center justify-center rounded-md border border-border bg-card p-2 shadow hover:bg-muted"
          aria-label="Expand sidebar">
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-card transition-transform ${
        open ? "translate-x-0" : "-translate-x-full"
      } ${collapsed ? "md:-translate-x-full" : "md:translate-x-0"}`}>
        <div className="flex h-full flex-col">

          {/* Brand */}
          <div className="flex items-center justify-between border-b border-border px-4 py-4">
            <Link to="/chat" onClick={() => setOpen(false)} className="flex items-center">
              <AtomWordmark size="md" />
            </Link>
            <button type="button" onClick={() => setCollapsed(true)}
              className="hidden md:inline-flex items-center justify-center rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Collapse sidebar">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>

          {/* New chat */}
          <div className="p-3">
            <button type="button" onClick={handleNewChat} disabled={!studentId || creating}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              New chat
            </button>
          </div>

          {/* Scroll area */}
          <div className="flex-1 overflow-y-auto px-2 space-y-4 pb-4">

            {/* Previous sessions */}
            <div>
              <div className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Previous sessions
              </div>
              {loadingThreads ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
              ) : threads.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  {studentId ? "No sessions yet. Start a new chat." : "Sign in to see sessions."}
                </div>
              ) : (
                <ul className="space-y-0.5">
                  {threads.map((t) => {
                    const active = t.id === activeThreadId;
                    return (
                      <li key={t.id}>
                        <Link to="/chat/$threadId" params={{ threadId: t.id }} onClick={() => setOpen(false)}
                          className={`flex items-start gap-2 rounded-md px-2 py-2 text-sm transition ${
                            active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`} title={t.title}>
                          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                          <span className="line-clamp-2 break-words">{t.title || "Untitled session"}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Learning OS phases */}
            <div>
              <button
                onClick={() => setPhasesOpen((v) => !v)}
                className="flex w-full items-center justify-between px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
              >
                <span className="flex items-center gap-1.5"><Map className="h-3 w-3" /> Learning OS</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${phasesOpen ? "" : "-rotate-90"}`} />
              </button>

              {phasesOpen && (
                <div className="space-y-3 mt-1">
                  {/* Roadmap link */}
                  <Link to="/me/roadmap" onClick={() => setOpen(false)} className={navCls("/me/roadmap")}>
                    <Map className="h-3.5 w-3.5 shrink-0" />
                    <span>Roadmap</span>
                  </Link>

                  {PHASE_SECTIONS.map((section) => (
                    <div key={section.label}>
                      <div className={`flex items-center gap-1.5 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest ${section.color}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${section.dot}`} />
                        {section.label}
                      </div>
                      {section.links.map(({ to, icon: Icon, label }) => (
                        <Link key={to} to={to as any} onClick={() => setOpen(false)} className={navCls(to)}>
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span>{label}</span>
                        </Link>
                      ))}
                    </div>
                  ))}

                  {/* Architecture (foundation) */}
                  <div>
                    <div className="flex items-center gap-1.5 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                      Foundation
                    </div>
                    <Link to="/me/architecture" onClick={() => setOpen(false)} className={navCls("/me/architecture")}>
                      <Network className="h-3.5 w-3.5 shrink-0" />
                      <span>Memory Graph</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom */}
          <div className="border-t border-border p-2 space-y-0.5">
            {isAdmin && (
              <Link to="/admin" onClick={() => setOpen(false)} className={navCls("/admin")}>
                <Shield className="h-4 w-4" /><span>Admin</span>
              </Link>
            )}
            <button type="button" onClick={signOut}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
