#!/usr/bin/env bash
# new-plugin.sh —— 从 templates/tool-plugin 脚手架生成一个新工具类插件包。
#
# 用法： bash scripts/new-plugin.sh <plugin-name>
#   plugin-name 会同时用作目录名与 npm 包名（kebab-case，建议以 dsh- 开头，如 dsh-my-tool）。
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "用法: bash scripts/new-plugin.sh <plugin-name>"
  echo "示例: bash scripts/new-plugin.sh dsh-my-tool"
  exit 1
fi

NAME="$1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/templates/tool-plugin"
TARGET="$ROOT/packages/$NAME"

# 包名校验：npm 包名小写、无空格（允许 scoped 但这里统一非 scoped）
if ! [[ "$NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "!! 包名只能是 kebab-case（小写字母/数字/连字符，不能以连字符开头）: $NAME"
  exit 1
fi

if [ -d "$TARGET" ]; then
  echo "!! 目标已存在: $TARGET"
  exit 1
fi

mkdir -p "$TARGET"
# 拷贝模板（含隐藏文件）
cp -R "$TEMPLATE/." "$TARGET/"

# 替换占位符：<plugin-name>（完整包名）与 <entry-id>（kebab-case entry id，去 dsh- 前缀）
ENTRY_ID="${NAME#dsh-}"
find "$TARGET" -type f -not -path '*/node_modules/*' | while read -r f; do
  sed -i '' "s/<plugin-name>/$NAME/g" "$f" 2>/dev/null || sed -i "s/<plugin-name>/$NAME/g" "$f"
  sed -i '' "s/<entry-id>/$ENTRY_ID/g" "$f" 2>/dev/null || sed -i "s/<entry-id>/$ENTRY_ID/g" "$f"
done

echo "==> 已生成插件包: $TARGET"
echo "    下一步："
echo "      pnpm install"
echo "      cd $TARGET && code src/index.ts"
echo "      pnpm build && pnpm install:web"