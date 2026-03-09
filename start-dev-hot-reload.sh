#!/usr/bin/env bash
# Hot-reload dev server for VoxGlide
# Watches src/ and server/ for changes.
# On change: rebuilds SDK, restarts server.

PORT=3100
WATCH_DIRS="src server"
PID=""
COOLDOWN=3

TUNNEL_PID=""

cleanup() {
    echo ""
    echo "[dev] Shutting down..."
    [ -n "$PID" ] && kill "$PID" 2>/dev/null
    [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

cd "$(dirname "$0")"

build_sdk() {
    echo "[dev] Building SDK..."
    if ! npm run build 2>&1 | tail -5; then
        echo "[dev] !! Build FAILED — server will use last good build"
        return 1
    fi
    echo "[dev] Build OK"
    return 0
}

start_server() {
    cd server
    GEMINI_API_KEY="${GEMINI_API_KEY}" npx tsx index.ts &
    PID=$!
    cd ..
    echo "[dev] Server started (pid $PID)"
    for i in $(seq 1 20); do
        if curl -s http://localhost:$PORT/health >/dev/null 2>&1; then
            echo "[dev] Server ready"
            return 0
        fi
        sleep 0.5
    done
    echo "[dev] Warning: server didn't become ready in 10s"
}

kill_server() {
    if [ -n "$PID" ]; then
        echo "[dev] Stopping server (pid $PID)..."
        kill "$PID" 2>/dev/null
        wait "$PID" 2>/dev/null || true
        PID=""
    fi
    # Ensure port is actually free before returning
    for i in $(seq 1 10); do
        if ! ss -tlnp | grep -q ":${PORT} " 2>/dev/null; then
            return 0
        fi
        sleep 0.5
    done
    # Force kill anything still on the port
    local leftover=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ -n "$leftover" ]; then
        echo "[dev] Force killing leftover process on port $PORT"
        kill -9 $leftover 2>/dev/null || true
        sleep 1
    fi
}

snapshot() {
    find $WATCH_DIRS -type f \
        ! -path '*/node_modules/*' ! -name '*.map' ! -name '*.pem' \
        -exec stat -c '%Y %n' {} \; 2>/dev/null | sort
}

# Load .env if present
[ -f .env ] && export $(grep -v '^#' .env | xargs)

if [ -z "$GEMINI_API_KEY" ]; then
    echo "[dev] Error: GEMINI_API_KEY not set"
    echo "[dev] Usage: GEMINI_API_KEY=your-key ./start-dev-hot-reload.sh"
    echo "[dev] Or create a .env file with GEMINI_API_KEY=your-key"
    exit 1
fi

# Kill only our own server on the port (match "tsx index.ts" to avoid killing unrelated processes)
EXISTING=$(pgrep -f "tsx index.ts" 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
    echo "[dev] Killing existing voxglide server: $EXISTING"
    kill $EXISTING 2>/dev/null || true
    sleep 1
fi

echo "[dev] VoxGlide dev server with hot reload"
echo "[dev] Watching: $WATCH_DIRS"
echo "[dev] Press Ctrl+C to stop"
echo ""

# Start Cloudflare tunnel if config exists and not already running
CF_CONFIG="$HOME/.cloudflared/config-voxglide.yml"
if [ -f "$CF_CONFIG" ] && ! pgrep -f "cloudflared tunnel.*voxglide" >/dev/null 2>&1; then
    echo "[dev] Starting Cloudflare tunnel (voxglide.nextbt.ai)..."
    cloudflared tunnel --config "$CF_CONFIG" run voxglide >/dev/null 2>&1 &
    TUNNEL_PID=$!
    echo "[dev] Tunnel started (pid $TUNNEL_PID)"
else
    echo "[dev] Cloudflare tunnel already running or not configured"
fi

build_sdk
start_server
BASELINE=$(snapshot)

while true; do
    inotifywait -r -q \
        -e modify -e create -e delete -e move \
        --exclude '(node_modules|\.map$|\.pem$|\.tmp)' \
        $WATCH_DIRS

    CURRENT=$(snapshot)
    if [ "$CURRENT" = "$BASELINE" ]; then
        continue
    fi

    echo "[dev] Change detected, waiting ${COOLDOWN}s for things to settle..."

    while inotifywait -r -q -t "$COOLDOWN" \
        -e modify -e create -e delete -e move \
        --exclude '(node_modules|\.map$|\.pem$|\.tmp)' \
        $WATCH_DIRS 2>/dev/null; do
        echo "[dev] More changes detected, resetting ${COOLDOWN}s timer..."
    done

    kill_server
    build_sdk
    start_server
    BASELINE=$(snapshot)
done
