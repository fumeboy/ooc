#!/bin/bash
# dev-start.sh — Start backend + vite dev server for OOC-3 development.
#
# Usage:
#   bash scripts/dev-start.sh [--world ./.ooc-world] [--port 3000] [--vite-port 5173]
#
# Environment variables:
#   OOC_API_KEY (or ANTHROPIC_API_KEY) — required for real-LLM features
#   OOC_WORLD   — override world root (default: ./.ooc-world)
#
# Press Ctrl+C to stop both processes.

set -euo pipefail

WORLD="${OOC_WORLD:-./.ooc-world}"
BACKEND_PORT="${OOC_PORT:-3000}"
VITE_PORT="${OOC_VITE_PORT:-5173}"

# Parse args
while [[ $# -gt 0 ]]; do
    case "$1" in
        --world) WORLD="$2"; shift 2 ;;
        --port) BACKEND_PORT="$2"; shift 2 ;;
        --vite-port) VITE_PORT="$2"; shift 2 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[dev] worldRoot=$WORLD port=$BACKEND_PORT vitePort=$VITE_PORT"
echo "[dev] Starting backend..."

# Start backend
bun "$ROOT/src/app/server/index.ts" --world "$WORLD" --port "$BACKEND_PORT" &
BACKEND_PID=$!

# Start vite dev server
echo "[dev] Starting vite dev server..."
cd "$ROOT/web"
OOC_API_TARGET="http://127.0.0.1:${BACKEND_PORT}" bunx vite --port "$VITE_PORT" &
VITE_PID=$!

echo "[dev] Backend PID=$BACKEND_PID | Vite PID=$VITE_PID"
echo "[dev] UI: http://localhost:${VITE_PORT}"
echo "[dev] API: http://localhost:${BACKEND_PORT}/api/health"
echo "[dev] Press Ctrl+C to stop"

# Cleanup on exit
cleanup() {
    echo ""
    echo "[dev] Stopping..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$VITE_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
    echo "[dev] Done"
}
trap cleanup EXIT INT TERM

wait
