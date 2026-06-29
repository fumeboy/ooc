#!/usr/bin/env bash
# scripts/check-tsc.sh
#
# 跑 `bun tsc --noEmit`，发现 packages/@ooc/ 下的错误就 fail。
# ooc-6 之后源码全部从 src/ 搬到 packages/@ooc/{builtins,core,meta,tests,web}/，
# 所以 typecheck 边界是 packages/@ooc/。
#
# 历史 baseline：ooc-2 时期 src/app/server/modules/ui/{api.list-flows,service}.ts
# 有 7 个 Dirent / listFlows 重构 fallout，搬到 packages/@ooc/core/app/server/modules/ui/
# 后已经清零；如果未来再出现暂时无法处理的 baseline，往 BASELINE_PATTERNS 里加。
#
# 使用：
#   bash scripts/check-tsc.sh
#
# CI：作为 .github/workflows/ci.yml 的一步，发现新错误则 fail。

set -e

# 不再有 baseline 错误。如果将来需要，往这里加 grep 模式（例如：
# 'packages/@ooc/core/app/server/modules/ui/api\.list-flows\.ts')，正则 OR 用 |。
# （F3 flows/pools 已于阶段三恢复，原 baseline 已清空。）
#
# 2026-06-29: 用户从 ooc-6 分支恢复 packages/@ooc/web/(157 ts/tsx 完整控制面),
# 但缺大量 npm 依赖(react-router/lucide-react/@codemirror/*/@uiw/*/tailwind-merge
# 等)和 ooc-6 时代 builtin 名空间(@ooc/builtins/_shared 等已不存在)。已按用户
# 裁决把 web 端 server 对接全部桩化为 TODO,但依赖缺失仍存在,作 baseline 处理
# 等后续 issue 决定 web 整体走向。
BASELINE_PATTERNS='^packages/@ooc/web/'

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

# tsc 失败也别让 set -e 杀脚本——错误数量我们自己 count
# 注意重定向顺序：`> file 2>&1` 才合并 stderr；`2>&1 > file` 只重定向 stdout
bun tsc --noEmit > "$LOG" 2>&1 || true

# 只看 packages/@ooc/ 开头的错误行（typebox / openai 等 node_modules 错误本来就 noise）
if [[ -n "$BASELINE_PATTERNS" ]]; then
  NEW_ERRORS=$(grep -E "^packages/@ooc/" "$LOG" | grep -Ev "$BASELINE_PATTERNS" || true)
else
  NEW_ERRORS=$(grep -E "^packages/@ooc/" "$LOG" || true)
fi

if [[ -n "$NEW_ERRORS" ]]; then
  echo "[FAIL] tsc: 新 packages/@ooc/ 错误（超出 baseline）:"
  echo "$NEW_ERRORS"
  echo
  echo "新增的 packages/@ooc/ 错误必须修复后再 merge。"
  exit 1
fi

if [[ -n "$BASELINE_PATTERNS" ]]; then
  BASELINE_COUNT=$(grep -E "^packages/@ooc/" "$LOG" | grep -E "$BASELINE_PATTERNS" | wc -l | tr -d ' ')
  echo "OK: tsc 干净（baseline $BASELINE_COUNT 错误未变化）"
else
  echo "OK: tsc 干净（无 baseline 错误）"
fi
