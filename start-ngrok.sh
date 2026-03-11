#!/usr/bin/env bash
# Start ngrok tunnel for VoxGlide server (port 3100)
# Kills any existing ngrok process first to avoid stale tunnels.

set -euo pipefail

PORT="${1:-3100}"

# Kill any existing ngrok processes
if pgrep -x ngrok > /dev/null 2>&1; then
  echo "[ngrok] Killing existing ngrok process(es)..."
  pkill -x ngrok
  sleep 1
  # Force kill if still alive
  if pgrep -x ngrok > /dev/null 2>&1; then
    pkill -9 -x ngrok
    sleep 1
  fi
fi

echo "[ngrok] Starting tunnel for port $PORT..."
ngrok http "$PORT" --log=stdout > /dev/null 2>&1 &
NGROK_PID=$!

# Wait for ngrok API to be ready
for i in {1..20}; do
  if curl -s http://127.0.0.1:4040/api/tunnels > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Get the public URL
URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)

if [ -z "$URL" ]; then
  echo "[ngrok] Failed to get tunnel URL"
  kill $NGROK_PID 2>/dev/null
  exit 1
fi

echo ""
echo "[ngrok] Tunnel active (PID: $NGROK_PID)"
echo "[ngrok] URL: $URL"
echo "[ngrok] SDK: $URL/sdk/voice-sdk.iife.js"
echo "[ngrok] WS:  $(echo "$URL" | sed 's/https:/wss:/')"
echo ""
echo "Paste this into the extension: $URL"
echo ""
echo "Press Ctrl+C to stop"

# Keep running, forward SIGINT to ngrok
trap "kill $NGROK_PID 2>/dev/null; echo ''; echo '[ngrok] Stopped'; exit 0" INT TERM
wait $NGROK_PID
