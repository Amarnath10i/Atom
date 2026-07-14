# LAMA — Layered Atomic Memory Architecture
### Multi-Agent JEE / NEET Tutor

> Five specialist AI agents over a persistent molecular memory graph.  
> Gemini or Claude. Zero hardcoded keys. Runs in VS Code in 5 minutes.

---

## ⚡ Quick Start

### Requirements
- Node.js 20+ — check with `node --version`
- A free [Supabase](https://supabase.com) account
- At least one API key: **Gemini** (free) or **Claude**

---

### Step 1 — Install dependencies

```powershell
cd lama-project
npm install
```

---

### Step 2 — Configure your `.env`

```powershell
copy .env.example .env
```

Open `.env` in VS Code and fill in **all** of these:

```env
# ── Supabase ──────────────────────────────────────────────────────────────────
# Get from: https://supabase.com/dashboard → your project → Settings → API
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=eyJ...          # anon / public key
SUPABASE_SERVICE_ROLE_KEY=eyJ...         # service_role key (keep secret)

VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...     # same as anon key above

# ── LLM — set ONE (or both; Gemini is used first) ─────────────────────────────
# Free Gemini key: https://aistudio.google.com → Get API key
GEMINI_API_KEY=AIzaSy...

# OR Claude key: https://console.anthropic.com → API keys
ANTHROPIC_API_KEY=sk-ant-...
```

**Where to find Supabase keys:**
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. Open your project (create one if you don't have one — free tier works)
3. Left sidebar → **Project Settings** → **API**
4. Copy `Project URL`, `anon/public` key, and `service_role` key

---

### Step 3 — Set up the database

**Option A — Automatic (recommended):**
```powershell
node scripts/setup-db.js
```
This runs the full database schema directly on your Supabase project.

**Option B — Manual (if Option A fails):**
1. Open [supabase.com/dashboard](https://supabase.com/dashboard) → your project
2. Left sidebar → **SQL Editor** → **New query**
3. Open `supabase/migrations/*.sql` in VS Code, select all (`Ctrl+A`), copy
4. Paste into the SQL Editor → click **Run**
5. You should see "Success. No rows returned."

---

### Step 4 — Run

```powershell
npm run dev
```

Open **http://localhost:3000** — you'll see the landing page. Create an account at `/auth` to get started.

---

## 🏗 Architecture

```
Browser (React + TanStack Router)
  /                              Landing page
  /student/:id                   Dashboard — LAMA memory graph + heatmap + plan
  /student/:id/chat/:threadId    Chat — live 5-agent streaming loop

POST /api/chat  (streaming SSE)
  │
  ├─ [NemoGuard]   Regex safety pass — blocks harmful content
  ├─ [Curator]     Loads top-20 LAMA atoms from Supabase
  ├─ [LLM]         Gemini 1.5 Flash  OR  Claude (from .env — no hardcoding)
  │    └─ tool calls ──────────────────────────────────────────────────────────
  │         diagnose_weakness  → writes to weak_topics table
  │         generate_practice  → returns NCERT-aligned question scaffold
  │         update_plan        → writes to plan_items table
  │         reflect_session    → upserts memory_atoms + memory_bonds (LAMA graph)
  │
  └─ streams tokens → browser

Supabase Postgres (LAMA memory)
  students       — 10 seeded JEE/NEET students
  threads        — chat sessions per student
  messages       — full conversation history
  memory_atoms   — knowledge nodes (subject/topic/strength/reviews)
  memory_bonds   — graph edges between atoms (weight, decay)
  weak_topics    — Diagnostic Agent outputs
  plan_items     — Planner Agent 6-month roadmap
  reflections    — Critic Agent session summaries
```

---

## 🤖 5-Agent Pipeline

| # | Agent | Role | How invoked |
|---|-------|------|-------------|
| 0 | **NemoGuard** | Safety pass — blocks harmful queries | Pre-LLM regex |
| 1 | **Curator** | Reads LAMA atoms, assembles memory context | Automatic per request |
| 2 | **Diagnostic** | Detects weak topics, logs with severity | LLM tool call |
| 3 | **Content Curator** | Generates NCERT-aligned practice questions | LLM tool call |
| 4 | **Planner** | Builds / updates 6-month study roadmap | LLM tool call |
| 5 | **Critic** | Writes session reflection, updates atoms + bonds | LLM tool call |

---

## 🔑 Model Selection (via `.env` only)

```env
# Use Gemini (default — free tier available)
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-1.5-flash          # or: gemini-1.5-pro, gemini-2.0-flash-exp

# Switch to Claude (comment out GEMINI_API_KEY)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-haiku-4-5-20251001  # or: claude-sonnet-4-20250514
```

No code changes needed — just edit `.env` and restart `npm run dev`.

---

## Using NVIDIA NIM (optional)

**Swap to NVIDIA Nemotron (2-line change in `ai-gateway.server.ts`):**
```typescript
// Add this branch before the gemini check:
if (process.env.NVIDIA_API_KEY) {
  const { createOpenAI } = await import("@ai-sdk/openai");
  const nim = createOpenAI({ baseURL: "https://integrate.api.nvidia.com/v1", apiKey: process.env.NVIDIA_API_KEY });
  return { name: "gemini", model: nim("nvidia/llama-3.1-nemotron-70b-instruct") };
}
```
Then add `NVIDIA_API_KEY=nvapi-...` to `.env`.

---

## 📁 Key Files

```
.env.example                          ← copy → .env, fill in keys
scripts/setup-db.js                   ← node scripts/setup-db.js
supabase/migrations/*.sql             ← full database schema

src/lib/ai-gateway.server.ts          ← Gemini / Claude / Nemotron switcher
src/lib/config.server.ts              ← env var helpers + validation
src/routes/api/chat.ts                ← 5-agent streaming POST handler  ← main logic
src/routes/index.tsx                  ← landing page
src/routes/student.$studentId.tsx     ← memory graph dashboard
src/routes/student.$studentId.chat.$threadId.tsx  ← chat UI
```

---

## 🔒 Security

- `.env` is in `.gitignore` — never committed
- `SUPABASE_SERVICE_ROLE_KEY` only in `.server.ts` files — never reaches the browser
- All API keys read from `process.env` inside server functions — never from `import.meta.env`

---

## 👤 Real Users (Auth) — added in v5.1

LAMA supports **real user sign-up**.

### What you get
- `/auth` — email + password sign-up / sign-in page
- `/me/architecture` — every signed-in student sees **their own LAMA molecular memory graph** (atoms, bonds, weak topics, reflections) via the left sidebar **"View Architecture"** button
- `/admin` — admin dashboard still works (password gate). Admins linked via `user_roles` also get the **Admin** entry in the sidebar
- A `user_roles` table with `admin` / `student` roles
- A `profiles` table auto-populated on signup
- `students.auth_user_id` links a real auth user to their own student row

### One-time setup
1. Run `node scripts/setup-db.js` — the new migration `20260611000000_auth_users_and_roles.sql` runs automatically.
2. In your Supabase dashboard → **Authentication → Providers → Email**, make sure email is enabled.
3. (Optional, for local dev) disable "Confirm email" so signup logs in immediately.

### Promote yourself to admin
After signing up the first time, in Supabase **SQL Editor**:
```sql
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE email = 'you@example.com'
ON CONFLICT DO NOTHING;
```
Reload — the sidebar will now show **Admin**.

### Sidebar navigation
A left-side sidebar is shown automatically on all authenticated pages (under `/_authenticated/*`) with:
- 🏠 Home
- 🧬 View Architecture  ← your personal LAMA graph
- 🛡 Admin (only for users with the `admin` role)
- ⎋ Sign out
