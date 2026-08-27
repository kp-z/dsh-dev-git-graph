#!/usr/bin/env bash
# remove-from-profile.sh —— 从指定 dsh profile 卸载本工作区所有插件。
#
# 用法： bash scripts/remove-from-profile.sh [profile]   （默认 profile: web）
#
# 行为：对每个声明了 dsh.bundle 的包执行 `dsh plugin --profile <profile> remove <pkg>`。
# 幂等：重复执行安全（已移除的包会跳过）。
set -euo pipefail

PROFILE="${1:-web}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 从 profile: $PROFILE 卸载插件"

for pkg in $(find packages -maxdepth 1 -type d -mindepth 1 | sort); do
  name="$(node -p "require('./$pkg/package.json').name" 2>/dev/null || true)"
  bundle="$(node -p "!!(require('./$pkg/package.json').dsh && require('./$pkg/package.json').dsh.bundle)" 2>/dev/null || true)"
  if [ -n "$name" ] && [ "$bundle" = "true" ]; then
    echo "    - 卸载 ${name}"
    dsh plugin --profile "$PROFILE" remove "$name" 2>&1 || echo "    !! remove 失败或包未安装"
  fi
done

echo "==> 完成。请重启 dsh 使卸载生效。"
