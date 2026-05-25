#!/usr/bin/env bash
# scripts/check-tsc.sh
#
# 跑 `bun tsc --noEmit` 但只在出现 **新** src/ 错误时 fail。
# 当前 baseline 有 7 个错误，都在 src/app/server/modules/ui/ 下两个文件——
# 跟 2026-05-23 Dirent / listFlows 重构未跟进有关，本次清理范围外。
#
# 移除 baseline 的方式：等 UI 模块清理后，把对应 BASELINE_PATTERNS 删空。
#
# 使用：
#   bash scripts/check-tsc.sh
#
# CI：作为 .github/workflows/ci.yml 的一步，发现新错误则 fail。

set -e

# baseline 错误位点（grep 模式，正则 OR 用 |）
BASELINE_PATTERNS='src/app/server/modules/ui/api.list-flows.ts|src/app/server/modules/ui/service.ts'

LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

# tsc 失败也别让 set -e 杀脚本——错误数量我们自己 count
# 注意重定向顺序：`> file 2>&1` 才合并 stderr；`2>&1 > file` 只重定向 stdout
bun tsc --noEmit > "$LOG" 2>&1 || true

# 只看 src/ 开头的错误行（typebox / openai 等 node_modules 错误本来就 noise）
NEW_ERRORS=$(grep -E "^src/" "$LOG" | grep -Ev "$BASELINE_PATTERNS" || true)

if [[ -n "$NEW_ERRORS" ]]; then
  echo "[FAIL] tsc: 新 src/ 错误（超出 baseline）:"
  echo "$NEW_ERRORS"
  echo
  echo "baseline 错误在 src/app/server/modules/ui/api.list-flows.ts 和 service.ts"
  echo "（2026-05-23 Dirent / listFlows 重构未跟进），本次清理范围外。"
  echo "新增的 src/ 错误必须修复后再 merge。"
  exit 1
fi

BASELINE_COUNT=$(grep -E "^src/" "$LOG" | grep -E "$BASELINE_PATTERNS" | wc -l | tr -d ' ')
echo "OK: tsc 干净（baseline $BASELINE_COUNT 错误未变化）"
