# ── LAMA — PowerShell startup launcher ───────────────────────────────────────
# Starts both services in separate windows.
# Run from the project root:  .\start-dev.ps1
# If you get "execution policy" errors:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-Not (Test-Path ".env")) {
    Write-Host "[ERROR] .env not found. Copy .env.example → .env and fill in your keys." -ForegroundColor Red
    exit 1
}

# ── Python venv setup ──────────────────────────────────────────────────────────
if (-Not (Test-Path "agents\.venv")) {
    Write-Host "[SETUP] Creating Python virtual environment..." -ForegroundColor Cyan
    python -m venv agents\.venv
    Write-Host "[SETUP] Installing Python dependencies..." -ForegroundColor Cyan
    & agents\.venv\Scripts\pip install -q -r agents\requirements.txt
}

# ── Start agents service ───────────────────────────────────────────────────────
Write-Host "[START] Python agents → http://localhost:8787" -ForegroundColor Green
$agentsCmd = "agents\.venv\Scripts\activate; uvicorn agents.main:app --port 8787 --host 0.0.0.0 --reload; Read-Host 'Press Enter to close'"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $agentsCmd

Start-Sleep -Seconds 3

# ── Start frontend ─────────────────────────────────────────────────────────────
Write-Host "[START] Vite frontend  → http://localhost:3000" -ForegroundColor Green
npm run dev
