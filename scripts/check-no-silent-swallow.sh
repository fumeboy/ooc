#!/usr/bin/env bash
# scripts/check-no-silent-swallow.sh
#
# silent-swallow ban audit（meta/object.doc.ts:observable.silent_swallow_ban）。
# 扫源码里的 silent-swallow 模式，要求每处都带 `// intentional:` 注释说明意图。
#
# 检测的模式：
#   1. bare `catch {}` 或 `catch (e) {}`（无任何动作，错误彻底吞噬）
#   2. `.catch(() => undefined)` 默默吞 promise rejection
#
# 合理静默必须在同一行或紧邻上一行带 `// intentional:` 注释（含 sandbox 例外
# 白名单、unused-import keep-alive 等）。
#
# 不检测的模式（成本 vs 收益不划算）：
#   - `void someAsyncCall()`：`void x` 在 TypeScript 表达式中合法用例太多
#     （`return void cb()` / type-level void 等），grep 假阳率高
#   - exec 层依赖 render 报告语义错误：语义层模式，grep 检测不出
#
# 使用：
#   bash scripts/check-no-silent-swallow.sh
#
# CI：作为 .github/workflows/ci.yml 的一步，发现违规则 fail。
#
# 历史依据：D1/D2 段 backlog（docs/2026-05-25-backlog-after-fix-plan.md）
# 决定不引入 ESLint framework，用此 grep audit 防回归。

set -e

PATTERNS=(
  # bare catch {} / catch (e) {} —— BSD grep 用 ERE
  'catch[[:space:]]*\([^)]*\)[[:space:]]*\{[[:space:]]*\}'
  'catch[[:space:]]*\{[[:space:]]*\}'
  # .catch(() => undefined)
  '\.catch\([[:space:]]*\([[:space:]]*\)[[:space:]]*=>[[:space:]]*undefined[[:space:]]*\)'
)

# scan 范围：packages/@ooc/{builtins,core,web} 下的运行代码
# （packages/@ooc/tests/ 与 scripts/ 自身允许吞噬测试夹具错误，packages/@ooc/meta/
# 是文档不是运行代码）
SCAN_DIRS=(
  "packages/@ooc/builtins"
  "packages/@ooc/core"
  "packages/@ooc/web"
)

VIOLATIONS=0
for pattern in "${PATTERNS[@]}"; do
  while IFS= read -r match; do
    [[ -z "$match" ]] && continue
    file="${match%%:*}"
    rest="${match#*:}"
    line="${rest%%:*}"
    content="${rest#*:}"

    # 1. 同一行带 // intentional: → 合理静默
    if [[ "$content" == *"intentional:"* ]]; then
      continue
    fi

    # 2. 上方 5 行内带 // intentional: → 合理静默
    #    （支持多行注释块 + 中间空行的情况；范围窄到不会跨函数）
    found_intentional=0
    if [[ "$line" -gt 1 ]]; then
      start=$((line - 5))
      [[ "$start" -lt 1 ]] && start=1
      end=$((line - 1))
      window=$(sed -n "${start},${end}p" "$file")
      if [[ "$window" == *"intentional:"* ]]; then
        found_intentional=1
      fi
    fi
    if [[ "$found_intentional" -eq 1 ]]; then
      continue
    fi

    echo "[FAIL] silent-swallow without // intentional:"
    echo "  $file:$line: $content"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep -rnE "$pattern" "${SCAN_DIRS[@]}" --include='*.ts' --include='*.tsx' 2>/dev/null || true)
done

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Found $VIOLATIONS silent-swallow violation(s)."
  echo "Each silent-swallow site must have a '// intentional: <reason>' comment"
  echo "on the same line or directly above. See meta/object.doc.ts:silent_swallow_ban"
  echo "for the policy. If your case fits the sandbox exception, label it"
  echo "'// intentional: sandbox ...' per the exception whitelist."
  exit 1
fi

echo "OK: no silent-swallow violations in packages/@ooc/"
