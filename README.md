# Atom

**An AI tutor for JEE / NEET whose student model is learned from 16 million practice attempts, not hand-set.**

Atom (internally *LAMA*, Layered Atomic Memory Architecture) is a multi-agent tutor:
five specialist agents read and write a per-student memory graph of topics
("atoms") and links between them ("bonds"), and a planner schedules reviews.
The memory graph used to be driven by hand-picked numbers. The [`ml/`](ml/)
package replaces them with models trained and evaluated on real learner data
and ships the winner to the app, with serving tested to reproduce training exactly.

Live: [theatom.vercel.app](https://theatom.vercel.app) (web) · [atom-agents.vercel.app](https://atom-agents.vercel.app) (agents API)

## What the ML found

All numbers are on learners the models never saw, with 95% bootstrap intervals
over learners. Details and every table: [ml/README.md](ml/README.md), [`ml/reports/`](ml/reports/).

**Will this student answer the next question correctly?** Junyi Academy, 3.2M attempts by 14,453 held-out students.

| model | AUC | log loss | calibration error |
|---|---|---|---|
| Atom's old mastery rule, as displayed | 0.590 (0.587–0.592) | 0.985 | 0.409 |
| BKT per exercise | 0.736 | 0.529 | 0.007 |
| SAKT (self-attention) | 0.741 | 0.526 | 0.006 |
| **LightGBM on signals Atom records (shipped)** | **0.742 (0.739–0.745)** | **0.524** | **0.001** |
| DKT (LSTM) | 0.755 | 0.516 | 0.010 |

- **+0.152 AUC over the old rule**, which ranked right and wrong answers worse than exercise difficulty alone and showed ~35% mastery to students who get 70% right.
- **A strict visibility rule**: Junyi timestamps are rounded to 15 minutes and 71% of attempts share a bucket with another exercise, so every model, including DKT and SAKT, only sees earlier buckets. Ignoring this inflates AUC by +0.0008: measured, not assumed.
- **Forgetting curves**: half-life regression reproduces Settles & Meeder (ACL 2016) on Duolingo (MAE 0.127 vs the paper's 0.128). Atom's old recall formula did worse than predicting the mean, and on self-paced Junyi practice every time-decay model scores below chance, so review timing ships from the Duolingo fit.
- **Topic graph**: at equal density, links learned from co-performance add +0.0033 AUC, a curated topic tree +0.0023, embedding neighbours +0.0007, random links 0. Atom's old cosine ≥ 0.45 rule linked 70% of all pairs.
- **Serving parity**: replaying 3,903 attempts through the agents service gives a largest probability difference of 5.6e-16. The replay caught a float32/float64 mismatch that had moved 12% of served predictions.

## How Atom works

| # | Agent | Role |
|---|---|---|
| 0 | NemoGuard | safety pass before the LLM |
| 1 | Curator | loads the student's top memory atoms into context |
| 2 | Diagnostic | detects weak topics (LLM tool call) |
| 3 | Content Curator | generates NCERT-aligned practice questions |
| 4 | Planner | builds and updates the study plan |
| 5 | Critic | writes the session reflection and updates atoms and bonds |

- **Web app**: React + TanStack Start, streaming chat over SSE, memory-graph dashboard.
- **Agents service**: Python FastAPI; serves the learned student model (mastery per topic and next review date from graded answers).
- **Data**: Supabase Postgres (students, threads, memory atoms and bonds, graded answers, plans).
- **LLM**: Ollama, local or Ollama Cloud, chosen in `.env`; no keys in code.

## Quick Start

### Requirements
- Node.js 20+ — check with `node --version`
- A free [Supabase](https://supabase.com) account
- [Ollama](https://ollama.com) installed locally, or an Ollama Cloud API key

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

# ── LLM — Ollama ──────────────────────────────────────────────────────────────
OLLAMA_BASE_URL=http://localhost:11434   # or https://ollama.com for Ollama Cloud
OLLAMA_API_KEY=                          # only needed for Ollama Cloud
OLLAMA_MODEL=gpt-oss:120b                # any model your Ollama can serve
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

## Deploy

Live: **https://theatom.vercel.app** (web) and **https://atom-agents.vercel.app** (agents).

Two Vercel projects plus Supabase for data and Ollama Cloud for the LLM:

| Part | Where | Deploy with |
|---|---|---|
| Web app (TanStack Start via Nitro) | Vercel project `atom`, repo root | `npx vercel deploy --prod` from the repo root |
| Python agents (FastAPI) | Vercel project `atom-agents`, `agents/` folder | `npx vercel deploy --prod` from `agents/` |
| Database + auth | Supabase | `npm run setup` (runs `supabase/migrations`) |

Environment variables (Vercel → Project → Settings → Environment Variables):

| Variable | `atom` | `atom-agents` |
|---|---|---|
| `OLLAMA_BASE_URL` = `https://ollama.com` | ✓ | ✓ |
| `OLLAMA_API_KEY` (ollama.com/settings/keys) | ✓ | ✓ |
| `OLLAMA_MODEL` = `gpt-oss:120b` | ✓ | ✓ |
| `AGENTS_TOKEN` (same random string on both) | ✓ | ✓ |
| `AGENTS_URL` = `https://atom-agents.vercel.app` | ✓ | |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | ✓ | |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (public, baked in at build) | ✓ | |
| `ADMIN_PASSWORD` | ✓ | |

In Supabase → Authentication → URL Configuration, the **Site URL** is `https://theatom.vercel.app`.

`https://theatom.vercel.app/api/health` reports which settings are present and makes a live LLM call.

**Alternative for the agents:** `agents/Dockerfile` + `railway.json` deploy them to Railway (or any Docker host) instead; point `AGENTS_URL` at that URL.

To run the production build locally: `npm run build && npm start` (port 3000).

### One-time backfills (existing data)

New chats fill these in automatically; these scripts cover data saved before the features existed. Both read `.env`, skip rows that are already done, and accept `--dry-run`.

```bash
node scripts/backfill-bonds.mjs                                   # links between existing topics
node --experimental-strip-types scripts/backfill-exam-units.mjs   # exam unit for each topic
```

---

## Architecture

```
Browser (React + TanStack Router)
  /                              Landing page
  /student/:id                   Dashboard — LAMA memory graph + heatmap + plan
  /student/:id/chat/:threadId    Chat — live 5-agent streaming loop

POST /api/chat  (streaming SSE)
  │
  ├─ [NemoGuard]   Regex safety pass — blocks harmful content
  ├─ [Curator]     Loads top-20 LAMA atoms from Supabase
  ├─ [LLM]         Ollama — local or Ollama Cloud (from .env — no hardcoding)
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

## Model Selection (via `.env` only)

```env
# Local Ollama (default)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3:8b                  # anything from `ollama list`

# Ollama Cloud (needed when deployed)
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=...                     # https://ollama.com/settings/keys
OLLAMA_MODEL=gpt-oss:120b              # a cloud model name, without ":cloud"
```

No code changes needed — just edit `.env` and restart `npm run dev`.

---

## Key Files

```
.env.example                          ← copy → .env, fill in keys
scripts/setup-db.js                   ← node scripts/setup-db.js
supabase/migrations/*.sql             ← full database schema

src/lib/ai-gateway.server.ts          ← Ollama model setup
src/lib/config.server.ts              ← env var helpers + validation
src/routes/api/chat.ts                ← 5-agent streaming POST handler  ← main logic
src/routes/index.tsx                  ← landing page
src/routes/student.$studentId.tsx     ← memory graph dashboard
src/routes/student.$studentId.chat.$threadId.tsx  ← chat UI
```

---

## Security

- `.env` is in `.gitignore` — never committed
- `SUPABASE_SERVICE_ROLE_KEY` only in `.server.ts` files — never reaches the browser
- All API keys read from `process.env` inside server functions — never from `import.meta.env`

---

## Real Users (Auth) — added in v5.1

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
