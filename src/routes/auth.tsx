import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { upsertMyStudent } from "@/lib/auth.functions";
import { toast } from "sonner";
import { LogIn, UserPlus, Eye, EyeOff } from "lucide-react";
import { AtomWordmark } from "@/components/AtomMark";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Atom" },
      { name: "description", content: "Sign in or create your Atom account." },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [exam, setExam] = useState<"JEE" | "NEET">("JEE");
  const [grade, setGrade] = useState(12);
  const [language, setLanguage] = useState<"english" | "hinglish">("english");
  const [city, setCity] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // If already signed in, push to home
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/chat" });
    });
  }, [navigate]);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });

        if (error) {
          const m = error.message.toLowerCase();
          if (
            m.includes("already registered") ||
            m.includes("already exists") ||
            m.includes("user already")
          ) {
            toast.error("An account with this email already exists. Please sign in.");
            setMode("signin");
            setPassword("");
            return;
          }
          throw error;
        }

        // Supabase hides duplicate emails (when confirmations are on) by
        // returning a user with an empty identities array instead of an error.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          toast.error("An account with this email already exists. Please sign in.");
          setMode("signin");
          setPassword("");
          return;
        }

        // Log the user straight in on account creation. signUp only returns a
        // session when email confirmation is disabled; when it doesn't, sign in
        // immediately with the same credentials so creating an account also
        // logs you in. If the project still requires email confirmation, that
        // sign-in fails and we fall back to the "check your email" flow.
        if (!data.session) {
          const { data: signInData, error: signInErr } =
            await supabase.auth.signInWithPassword({ email, password });
          if (signInErr || !signInData.session) {
            toast.info(
              "Check your email and click the confirmation link, then sign in here.",
              { duration: 8000 }
            );
            setMode("signin");
            setPassword("");
            return;
          }
        }

        // Session established — create the student row
        try {
          await upsertMyStudent({
            data: {
              name: displayName || email.split("@")[0],
              exam,
              grade,
              language,
              city: city || undefined,
            },
          });
        } catch (studentErr) {
          // Non-fatal: student row creation failed but auth succeeded
          console.warn("[auth] upsertMyStudent failed:", studentErr);
        }

        toast.success("Welcome to Atom");
        navigate({ to: "/chat" });
      } else {
        // Sign in
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          // Provide friendly messages for common errors
          if (error.message.toLowerCase().includes("invalid login")) {
            throw new Error("Incorrect email or password. Please try again.");
          }
          if (error.message.toLowerCase().includes("email not confirmed")) {
            throw new Error("Please confirm your email first. Check your inbox for the confirmation link.");
          }
          throw error;
        }

        // If student row doesn't exist yet (e.g., confirmed after signup), create it
        if (data.user) {
          try {
            const { getMe } = await import("@/lib/auth.functions");
            const me = await getMe();
            if (!me.student) {
              await upsertMyStudent({
                data: {
                  name: (data.user.user_metadata?.display_name as string | undefined) || email.split("@")[0],
                  exam: "JEE",
                  grade: 12,
                  language: "english",
                },
              });
            }
          } catch {
            // Best-effort — don't block sign-in
          }
        }

        toast.success("Signed in ✓");
        navigate({ to: "/chat" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center">
          <AtomWordmark size="lg" />
        </Link>
        <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
          {/* Tab switcher */}
          <div className="mb-6 flex gap-2 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => { setMode("signin"); setPassword(""); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === "signin" ? "bg-background shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LogIn className="mr-1 inline h-4 w-4" /> Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setPassword(""); }}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === "signup" ? "bg-background shadow" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <UserPlus className="mr-1 inline h-4 w-4" /> Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "signup" && (
              <>
                <Field label="Your name">
                  <input
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="input"
                    placeholder="Aarav Sharma"
                    autoComplete="name"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Exam">
                    <select
                      value={exam}
                      onChange={(e) => setExam(e.target.value as "JEE" | "NEET")}
                      className="input"
                    >
                      <option value="JEE">JEE</option>
                      <option value="NEET">NEET</option>
                    </select>
                  </Field>
                  <Field label="Class">
                    <select
                      value={grade}
                      onChange={(e) => setGrade(Number(e.target.value))}
                      className="input"
                    >
                      {[9, 10, 11, 12, 13].map((g) => (
                        <option key={g} value={g}>
                          {g === 13 ? "Drop year" : `Class ${g}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Language">
                    <select
                      value={language}
                      onChange={(e) => setLanguage(e.target.value as "english" | "hinglish")}
                      className="input"
                    >
                      <option value="english">English</option>
                      <option value="hinglish">Hinglish</option>
                    </select>
                  </Field>
                  <Field label="City (optional)">
                    <input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="input"
                      placeholder="Delhi"
                      autoComplete="address-level2"
                    />
                  </Field>
                </div>
              </>
            )}

            <Field label="Email">
              <input
                ref={emailRef}
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
                autoComplete="email"
                autoCapitalize="none"
              />
            </Field>

            <Field label="Password">
              <div className="relative">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-10"
                  placeholder="At least 6 characters"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  Please wait…
                </>
              ) : mode === "signin" ? (
                "Sign in"
              ) : (
                "Create account"
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            By continuing you agree to our terms.{" "}
            <Link to="/" className="underline">
              Back home
            </Link>
          </p>
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid var(--border);
          background: var(--background);
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          outline: none;
          transition: box-shadow 0.15s;
        }
        .input:focus {
          box-shadow: 0 0 0 2px var(--ring);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
