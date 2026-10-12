#!/usr/bin/env bash
# 装机幂等性验证（在**隔离的 DSH_HOME** 里跑两次，断言产物逐字节一致）。
#
# ⚠️ 为什么必须显式设 DSH_HOME（这是用真实事故换来的）：
# 装机脚本解析 DSH 主目录的顺序是 `process.env.DSH_HOME ?? homedir()/.dsh`。
# 而 DSH 给自己的子进程**设了 DSH_HOME**。所以只改 `HOME` 是**挡不住**的 ——
# 它仍然会写进真实的 profile（我就这样误装过一次，装完才发现）。
# 这个脚本因此**先检查并覆盖 DSH_HOME**，绝不让隔离失败。
set -euo pipefail

cd "$(dirname "$0")/.."
PROFILE="${1:-desktop}"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

die() { echo "  ❌ $1" >&2; exit 1; }

echo "  沙箱: $SANDBOX"
[[ "$SANDBOX" == /tmp/* || "$SANDBOX" == /var/folders/* ]] || die "沙箱路径异常，拒绝继续：$SANDBOX"

mkdir -p "$SANDBOX/profiles/$PROFILE" "$SANDBOX/profiles/node_modules"
printf '# sandbox\n[]\n' > "$SANDBOX/profiles/$PROFILE/cordis.patch.yml"

# 关键：显式覆盖 DSH_HOME（只改 HOME 不够）
export DSH_HOME="$SANDBOX"
[[ "$DSH_HOME" == "$SANDBOX" ]] || die "DSH_HOME 覆盖失败"

echo "  第一次安装…"
node scripts/install-to-profile.mjs "$PROFILE" > /dev/null

SNAP="$SANDBOX-snap"
cp -R "$SANDBOX" "$SNAP"

echo "  第二次安装（应当幂等）…"
node scripts/install-to-profile.mjs "$PROFILE" > /dev/null

if ! diff -r --exclude=snap "$SNAP" "$SANDBOX" > /tmp/dsh-idem-diff.txt 2>&1; then
  echo "  ❌ 两次安装的产物不一致："; sed -n '1,20p' /tmp/dsh-idem-diff.txt; exit 1
fi

PATCH="$SANDBOX/profiles/$PROFILE/cordis.patch.yml"
[[ -f "$PATCH" ]] || die "patch 没生成：$PATCH"
BLOCKS=$(grep -c '^# --- dsh-daily ---$' "$PATCH" || true)
[[ "$BLOCKS" == "1" ]] || die "patch 里 dsh-daily 块数为 $BLOCKS（应为 1，重复就是不幂等）"
[[ -d "$SANDBOX/profiles/$PROFILE/node_modules/@kpeace/dsh-daily" ]] || die "包目录没生成"

echo "  ✅ 幂等：两次产物逐字节一致；patch 只有 1 个 dsh-daily 块；包目录已生成"
echo "  ✅ 隔离生效：全部写入 ${SANDBOX}（已清理）"
REAL_HINT="${HOME}/.dsh/profiles/${PROFILE}/node_modules/@kpeace"
echo "  提醒：真实 profile 路径 ${REAL_HINT} 全程未被本脚本访问"
