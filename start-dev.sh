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

# 3) Cloudflare tunnel (optional)
CF_CONFIG="$HOME/.cloudflared/config-voxglide.yml"
if [ -f "$CF_CONFIG" ] && ! pgrep -f "cloudflared tunnel.*voxglide" >/dev/null 2>&1; then
  echo "[dev] Starting Cloudflare tunnel..."
  cloudflared tunnel --config "$CF_CONFIG" run voxglide >/dev/null 2>&1 &
  PIDS+=($!)
  echo "[dev] Tunnel started"
fi

echo ""
echo "[dev] VoxGlide dev ready"
echo "[dev] SDK watcher:  rebuilds on src/ changes (no server restart)"
echo "[dev] Server watch: restarts on server/ changes only"
echo "[dev] http://localhost:$PORT"
echo "[dev] Press Ctrl+C to stop"
echo ""

# Wait for any child to exit
wait
