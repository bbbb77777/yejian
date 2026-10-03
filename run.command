#!/bin/zsh

set -e
cd "$(dirname "$0")"
PORT=8765
# Ollama is discovered and can be started from the reader's connection button.
python3 server.py "$PORT" >/tmp/pdf-studio-http.log 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
sleep 1
open "http://127.0.0.1:${PORT}/"
wait "$SERVER_PID"
