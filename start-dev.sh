#!/usr/bin/env bash
# Convenience launcher: starts agents (Python) + frontend (Node) in parallel.
set -e
cd "$(dirname "$0")"

if [ ! -d "agents/.venv" ]; then
  echo "▸ Creating Python venv + installing agent deps…"
  (cd agents && python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt)
fi

echo "▸ Starting Python agents on :8787"
(. agents/.venv/bin/activate && uvicorn agents.main:app --port 8787 --host 0.0.0.0) &
AGENTS_PID=$!

trap "kill $AGENTS_PID 2>/dev/null || true" EXIT

echo "▸ Starting Vite/TanStack on :5173"
npm run dev
