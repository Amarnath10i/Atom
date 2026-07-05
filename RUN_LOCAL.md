# LAMA — Run Locally (Windows / Mac / Linux)

LAMA has two services that run side-by-side:

| Service | Port | What it does |
|---------|------|--------------|
| **Frontend + TanStack server** (Node) | 3000 | Website, chat API, student/admin UI |
| **Agents service** (Python FastAPI) | 8787 | NeMo Guards, Curator, Diagnostic, Planner, Nucleus memory |

The Node side calls the Python side over HTTP. If Python is down the app keeps working with regex/heuristic fallbacks — no crashes.

---

## ✅ Prerequisites

| Tool | Min version | Install |
|------|------------|---------|
| **Node.js** | 18+ | https://nodejs.org |
| **Python** | 3.10+ | https://python.org |
| **npm** | comes with Node | — |
| **Supabase account** | free tier is enough | https://supabase.com |
| **LLM API key** | one of the three below | — |

**LLM options (one is enough):**
- 🟢 **Google Gemini** — free key at https://aistudio.google.com/apikey
- 🔵 **Anthropic Claude** — key at https://console.anthropic.com
- 🟠 **NVIDIA NIM** — key at https://build.nvidia.com (optional)

---

## Step 1 — Supabase project

1. Go to https://supabase.com → **New Project**
2. Choose a name, set a database password, pick a region near you
3. Once provisioned, go to **Project Settings → API** and copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon / public key**
   - **service_role key** ← keep this secret

---

## Step 2 — Environment file

```bash
# In the project root:
cp .env.example .env
```

Open `.env` and fill in at minimum:

```env
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key

# Pick ONE LLM:
GEMINI_API_KEY=your_gemini_key
# ANTHROPIC_API_KEY=your_anthropic_key
# NVIDIA_API_KEY=your_nvidia_key
```

Leave everything else at its defaults for now.

---

## Step 3 — Database schema + seed data

> **This only needs to run once per Supabase project.**

```bash
npm run setup
```

This runs `scripts/setup-db.js`, which reads ALL four migration files in
`supabase/migrations/` and applies them in order:

1. `20260609…` — core schema (students, atoms, bonds, threads, messages…)
2. `20260610…` — agent + nucleus memory extension
3. `20260611…` — auth users & roles
4. `20260614…` — **duplicate-atom fix** (normalises + deduplicates `memory_atoms`,
   adds BEFORE INSERT/UPDATE trigger, adds UNIQUE index)

It also seeds 10 demo students: Aarav, Priya, Rohan, Anika, Vikram, Sneha,
Kabir, Meera, Aditya, Ishita.

### If `npm run setup` fails (firewall / API issue)

Paste the migrations manually in the Supabase SQL editor:

1. Supabase dashboard → your project → **SQL editor** → **New query**
2. Open each file below in a text editor, copy all contents, paste, click **Run**:
   ```
   supabase/migrations/20260609142308_2447fe02-a5b0-4e64-9e21-349e395e8887.sql
   supabase/migrations/20260610180000_agents_and_nucleus.sql
   supabase/migrations/20260611000000_auth_users_and_roles.sql
   supabase/migrations/20260614000000_fix_atom_dedup.sql
   ```
3. Run them **in that order**, one at a time.

---

## Step 4 — Install Node dependencies

```bash
npm install
```

---

## Step 5 — Start both services

### 🪟 Windows

Double-click **`start-dev.bat`** — or from a terminal:
```cmd
start-dev.bat
```

Or with PowerShell (if you prefer):
```powershell
# Allow local scripts (one-time):
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\start-dev.ps1
```

Both open the agents service in a separate window, then launch the frontend in
the current window.

### 🍎 Mac / 🐧 Linux

```bash
chmod +x start-dev.sh
./start-dev.sh
```

This auto-creates a Python venv, installs dependencies, then starts both
services.

### 🔧 Manual (any OS)

**Terminal A — Python agents:**
```bash
cd agents
python -m venv .venv

# Mac/Linux:
source .venv/bin/activate
# Windows (cmd):
.venv\Scripts\activate
# Windows (PowerShell):
.venv\Scripts\Activate.ps1

pip install -r requirements.txt
cd ..
uvicorn agents.main:app --port 8787 --host 0.0.0.0 --reload
```

Confirm it's running — visit http://localhost:8787/health, you should see:
```json
{"ok": true, "llm": "gemini", "embeddings": "gemini", "safety_mode": "builtin", ...}
```

**Terminal B — Frontend:**
```bash
npm run dev
```

---

## Step 6 — Open the app

| URL | What's there |
|-----|-------------|
| http://localhost:3000 | Student dashboard — pick any student to start a session |
| http://localhost:3000/admin | Admin overview (password: value of `ADMIN_PASSWORD`, default `admin123`) |

---

## What to try

1. Pick a student → open a new tutoring thread → chat about any JEE/NEET topic.
2. After a few messages, open the **Admin** page → find **Agent orchestration**:
   - **Curator** — merges duplicate atoms, prunes stale ones, proposes bonds
   - **Diagnostic** — finds weak topics from the transcript
   - **Planner** — rebuilds the 6-week study plan
   - **State Infer** — labels each atom: `active / stuck / completed / planned / stale`
3. The **Nucleus memory** card lets you semantic-search atoms and apply a recency-decay session.
4. Safety tests — any message with a self-harm phrase gets blocked with a helpline number.

---

## Duplicate-atom fix (what changed)

The previous code compared atom `subject` + `topic` as raw LLM-generated strings,
so `"Math"` and `"Mathematics"` were treated as different topics — duplicates kept
accumulating silently.

**This release fixes it at every layer:**

| Layer | Fix |
|-------|-----|
| **App** (`src/routes/api/chat.ts`) | `canonicalSubject()` + `canonicalTopic()` normalise before every SELECT and INSERT |
| **DB trigger** (`20260614…` migration) | `BEFORE INSERT OR UPDATE` trigger normalises every write, even those that bypass the app |
| **DB constraint** (same migration) | `UNIQUE INDEX` on `(student_id, subject, topic)` rejects any remaining duplicates at the DB level |
| **Existing data** (same migration) | Deduplication loop merges every existing duplicate: absorbs `MAX(strength)`, `SUM(reviews)`, re-points all bonds, then deletes the leftover rows |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `npm run setup` says "SUPABASE_URL not set" | `.env` has `YOUR_PROJECT_ID` placeholder — replace with real value |
| `No LLM API key found` | Fill in at least one of `GEMINI_API_KEY / ANTHROPIC_API_KEY / NVIDIA_API_KEY` in `.env` |
| Agents health check shows `"llm": "none"` | Python `.env` not found — run the agents service from the project root, not from `agents/` |
| Port 3000 already in use | Edit `vite.config.ts` → change `port: 3000` to any free port |
| Port 8787 already in use | Add `AGENTS_URL=http://localhost:9000` to `.env` and change `--port 8787` to `--port 9000` in the start command |
| Windows: "execution policy" error | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once in PowerShell as admin |
| `python` not found on Windows | Try `python3` or install from https://python.org (tick "Add to PATH") |
