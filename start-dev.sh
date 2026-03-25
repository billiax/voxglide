#!/usr/bin/env bash
# VoxGlide dev environment
# - Rollup watches src/ and rebuilds SDK on change (server picks up new files automatically)
# - tsx watches server/ and restarts only the server on change
# - Cloudflare tunnel starts if configured

set -euo pipefail
cd "$(dirname "$0")"

# Load .env
[ -f .env ] && export $(grep -v '^#' .env | xargs)

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "[dev] Error: GEMINI_API_KEY not set"
  echo "[dev] Create a .env file with GEMINI_API_KEY=your-key"
  exit 1
fi

PORT="${PORT:-3100}"
PIDS=()

cleanup() {
  echo ""
  echo "[dev] Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Kill any leftover server on the port
  lsof -ti:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  wait 2>/dev/null || true
  echo "[dev] Done"
  exit 0
}
trap cleanup SIGINT SIGTERM

# Kill existing voxglide server if running
EXISTING=$(pgrep -f "tsx.*watch.*index\.ts" 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  echo "[dev] Killing existing server: $EXISTING"
  kill $EXISTING 2>/dev/null || true
  sleep 1
fi

# Initial SDK build
echo "[dev] Building SDK..."
npm run build 2>&1 | tail -5
echo "[dev] Build OK"
echo ""

# 1) Rollup watch — rebuilds SDK when src/ changes
echo "[dev] Starting SDK watcher (src/)..."
npx rollup -c rollup.config.mjs --watch --watch.onBundleEnd "echo '[sdk] Rebuild complete'" 2>&1 &
PIDS+=($!)

# 2) Server with tsx watch — restarts only when server/ changes
echo "[dev] Starting server watcher (server/)..."
cd server
GEMINI_API_KEY="$GEMINI_API_KEY" PORT="$PORT" npx tsx watch index.ts 2>&1 &
PIDS+=($!)
cd ..

# 3) Cloudflare tunnel
#    Named config (~/.cloudflared/config-voxglide.yml) → permanent URL
#    Otherwise, quick tunnel (random URL, no account needed — just `cloudflared` installed)
TUNNEL_HOST=""
TUNNEL_LOG="$(mktemp)"

CF_CONFIG="$HOME/.cloudflared/config-voxglide.yml"
if [ -f "$CF_CONFIG" ] && pgrep -f "cloudflared tunnel.*voxglide" >/dev/null 2>&1; then
  TUNNEL_HOST=$(grep -oP 'hostname:\s*\K\S+' "$CF_CONFIG" 2>/dev/null || true)
  echo "[dev] Named tunnel already running → https://${TUNNEL_HOST}"
elif [ -f "$CF_CONFIG" ]; then
  TUNNEL_HOST=$(grep -oP 'hostname:\s*\K\S+' "$CF_CONFIG" 2>/dev/null || true)
  echo "[dev] Starting named tunnel → https://${TUNNEL_HOST}"
  cloudflared tunnel --config "$CF_CONFIG" run >/dev/null 2>&1 &
  PIDS+=($!)
elif [ ! -f "$CF_CONFIG" ] && command -v cloudflared >/dev/null 2>&1; then
  echo "[dev] Starting quick tunnel (public HTTPS URL)..."
  cloudflared tunnel --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
  PIDS+=($!)
  for i in $(seq 1 30); do
    TUNNEL_HOST=$(grep -oP 'https://\K[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    if [ -n "$TUNNEL_HOST" ]; then break; fi
    sleep 0.5
  done
elif [ ! -f "$CF_CONFIG" ] && command -v ngrok >/dev/null 2>&1; then
  echo "[dev] Starting ngrok tunnel..."
  ngrok http "$PORT" --log=stdout --log-level=info >"$TUNNEL_LOG" 2>&1 &
  PIDS+=($!)
  for i in $(seq 1 30); do
    TUNNEL_HOST=$(grep -oP 'url=https://\K[a-z0-9-]+\.ngrok-free\.app' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
    if [ -n "$TUNNEL_HOST" ]; then break; fi
    sleep 0.5
  done
else
  echo "[dev] Tip: install cloudflared or ngrok for a public HTTPS tunnel"
fi

echo ""
echo "[dev] VoxGlide dev ready"
echo "[dev] SDK watcher:  rebuilds on src/ changes (no server restart)"
echo "[dev] Server watch: restarts on server/ changes only"
echo "[dev] Local:  http://localhost:$PORT"
if [ -n "$TUNNEL_HOST" ]; then
  echo "[dev] Public: https://${TUNNEL_HOST}"
  echo "[dev] SDK:    https://${TUNNEL_HOST}/sdk/voice-sdk.iife.js"
  echo "[dev] Admin:  https://${TUNNEL_HOST}/admin"
fi
echo "[dev] Press Ctrl+C to stop"
echo ""

# Wait for any child to exit
wait
