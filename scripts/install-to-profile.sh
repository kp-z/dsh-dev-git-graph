#!/usr/bin/env bash
# install-to-profile.sh —— 构建并安装所有插件到指定 dsh profile。
#
# 用法： bash scripts/install-to-profile.sh [profile]   （默认 profile: web）
#
# 行为：
#   1. 对所有插件包执行 pnpm build
#   2. 对每个声明了 dsh.bundle 的包，执行 `dsh plugin --profile <profile> add <pkg>`
#   3. 提示重启 dsh 生效
#
# 幂等：重复执行安全。
set -euo pipefail

PROFILE="${1:-web}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> [1/2] 构建所有插件包"
pnpm build

echo "==> [2/2] 安装到 profile: $PROFILE"
# 逐个安装 workspace 里声明了 dsh.bundle 的包
# 本地开发：用 file: 绝对路径安装（npm registry 没有未发布的本地包）；
# 用 `USE_REGISTRY=1 bash scripts/install-to-profile.sh` 则按包名从 registry 安装（需已发布）。
for pkg in $(find packages -maxdepth 1 -type d -mindepth 1 | sort); do
  name="$(node -p "require('./$pkg/package.json').name" 2>/dev/null || true)"
  bundle="$(node -p "!!(require('./$pkg/package.json').dsh && require('./$pkg/package.json').dsh.bundle)" 2>/dev/null || true)"
  if [ -n "$name" ] && [ "$bundle" = "true" ]; then
    if [ "${USE_REGISTRY:-0}" = "1" ]; then
      echo "    - 安装 ${name}（registry）→ ${PROFILE}"
      dsh plugin --profile "$PROFILE" add "$name" 2>&1 || echo "    !! dsh plugin add 失败（可能 pnpm 未在 PATH，或 profile 未初始化）"
    else
      echo "    - 安装 ${name}（file: ${ROOT}/${pkg}）→ ${PROFILE}"
      dsh plugin --profile "$PROFILE" add "file:$ROOT/$pkg" 2>&1 || echo "    !! dsh plugin add 失败（可能 pnpm 未在 PATH，或 profile 未初始化）"
    fi
  fi
done

echo ""
echo "==> 完成。请重启 dsh（profile=${PROFILE}）使插件生效。"
echo "    验证: dsh --dump-config --profile ${PROFILE} | grep -i example"
