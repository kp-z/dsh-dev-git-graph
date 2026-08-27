#!/usr/bin/env bash
# reinstall-in-profile.sh —— 开发联调：重建并重装到指定 profile。
#
# 用法： bash scripts/reinstall-in-profile.sh [profile]   （默认 profile: web）
#
# 等价于 remove-from-profile.sh + install-to-profile.sh，适合改代码后快速生效。
set -euo pipefail

PROFILE="${1:-web}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 重装到 profile: $PROFILE"
bash "$ROOT/scripts/remove-from-profile.sh" "$PROFILE"
echo ""
bash "$ROOT/scripts/install-to-profile.sh" "$PROFILE"
echo ""
echo "==> 重装完成。重启 dsh 生效。"