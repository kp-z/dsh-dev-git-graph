#!/usr/bin/env bash
# R431：测试 profile 的一键重载。
# 只重启指定端口（默认 3082），绝不碰 desktop 的 57449。
set -euo pipefail
PORT="${1:-3082}"
PROFILE="${2:-awteam}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${3:-$ROOT}"
LOG="/tmp/aw-dev-${PORT}.log"
cd "$ROOT"
PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false pnpm run build >/tmp/aw-dev-build.log 2>&1
for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  kill "$pid" 2>/dev/null || true
done
sleep 2
cd "$WORKDIR"
nohup env DSH_HOME="$HOME/.dsh" "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  --profile "$PROFILE" --port "$PORT" --no-open >"$LOG" 2>&1 &
for _ in $(seq 1 30); do
  if grep -q 'dsh web:' "$LOG" 2>/dev/null; then break; fi
  sleep 1
done
grep 'dsh web:' "$LOG" | tail -1
