@echo off
REM ── LAMA — Windows startup launcher ──────────────────────────────────────────
REM  Starts both services: Python agents on :8787 and Vite frontend on :3000
REM  Run this from the project root:  start-dev.bat

setlocal

IF NOT EXIST ".env" (
    echo [ERROR] .env not found. Please run:
    echo   copy .env.example .env
    echo   Then fill in your keys.
    pause
    exit /b 1
)

REM ── Python venv setup ────────────────────────────────────────────────────────
IF NOT EXIST "agents\.venv" (
    echo [SETUP] Creating Python virtual environment...
    python -m venv agents\.venv
    echo [SETUP] Installing Python dependencies...
    agents\.venv\Scripts\pip install -q -r agents\requirements.txt
)

REM ── Start agents service in a new window ─────────────────────────────────────
echo [START] Launching Python agents service on http://localhost:8787 ...
start "LAMA Agents :8787" cmd /k "agents\.venv\Scripts\activate && uvicorn agents.main:app --port 8787 --host 0.0.0.0 --reload"

REM ── Small delay so agents come up first ──────────────────────────────────────
timeout /t 3 /nobreak > nul

REM ── Start frontend ────────────────────────────────────────────────────────────
echo [START] Launching Vite / TanStack frontend on http://localhost:3000 ...
call npm run dev

endlocal
