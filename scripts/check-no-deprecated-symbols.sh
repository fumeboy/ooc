#!/usr/bin/env bash
# scripts/check-no-deprecated-symbols.sh
#
# plan §7 — 防回退守门：旧的 llm_methods / loadLlmServerMethods /
# program.function / runFunctionProgram 等已被硬切删除（D6）。
# 本脚本扫源码 + 测试，发现任何旧符号回流就 fail。
#
# 注意（2026-06-09 修正）：self.callMethod 曾在 D6 改名为 self.callCommand 而被列入禁单；
# 但后续 command→method 大重命名又把 callCommand 改回 callMethod，使 self.callMethod 重新成为
# ts/js sandbox 的合法当前 API（packages/@ooc/core/executable/object/self.ts:31 有实现，
# runtime.ts:12 保留）。故移除 self.callMethod 禁令——它误禁了当前合法 API。
#
# 使用：
#   bash scripts/check-no-deprecated-symbols.sh
#
# 推荐挂到 pre-push hook 或 CI 入口。
#
# 例外：以下文件中允许出现 "llm_methods" / 旧符号字面量：
#   - packages/@ooc/core/runtime/server-loader.ts          — D6 hard-cutover 抛错时引用
#   - packages/@ooc/core/executable/server/window-types.ts  — 历史变更说明注释
#   - packages/@ooc/core/executable/__tests__/server-loader.test.ts — 测试 D6 抛错路径
#
# 注意：UiServerMethod / UiServerMethodContext 是合法符号（visible 维度，D3 保留），
# 不在禁用名单。

set -e

# 注意：禁用名单中的字面量本身会出现在本脚本里 —— 自动 self-exclude
declare -a FORBIDDEN_PATTERNS=(
  "llm_methods"
  "loadLlmServerMethods"
  "loadServerMethods\\b"
  "runFunctionProgram"
  "program\\.function\\b"
  "OPEN_TOOL"
  "REFINE_TOOL"
  "SUBMIT_TOOL"
  "handleOpenTool"
  "handleRefineTool"
  "handleSubmitTool"
  "runCallCommandProgram"
  "program\\.callCommand"
)

# 允许列表（D6 硬切的合法引用点 + 概念文档）
ALLOW_LIST=(
  "packages/@ooc/core/runtime/server-loader.ts"
  "packages/@ooc/core/executable/server/window-types.ts"
  "packages/@ooc/core/executable/server/types.ts"
  "packages/@ooc/core/executable/__tests__/server-loader.test.ts"
  "packages/@ooc/core/executable/windows/_shared/command-types.ts"  # 历史变更说明注释
  "scripts/check-no-deprecated-symbols.sh"
  "packages/@ooc/meta/object.doc.ts"  # 概念文档需说明 D6 硬切
  "packages/@ooc/meta/cookbook.author-ooc-agent.doc.ts"  # 新模式 cookbook 含迁移说明
)

EXCLUDE_DIRS=(
  "meta_deprecated"
  "node_modules"
  ".git"
  ".ooc-world"
  ".ooc-world-test"
  "docs"  # plan 文件、归档 spec 内的描述合法
)

is_allowed() {
  local file="$1"
  for allowed in "${ALLOW_LIST[@]}"; do
    if [[ "$file" == "$allowed" ]]; then
      return 0
    fi
  done
  return 1
}

VIOLATIONS=0
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  args=(-rn -E "$pattern" packages/@ooc scripts)
  for d in "${EXCLUDE_DIRS[@]}"; do
    args+=(--exclude-dir="$d")
  done
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file="${line%%:*}"
    if is_allowed "$file"; then continue; fi
    echo "[FAIL] /$pattern/ in:"
    echo "  $line"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep "${args[@]}" 2>/dev/null || true)
done

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Found $VIOLATIONS violation(s) of plan §7 D6 hard-cutover rules."
  echo "Read docs/plans/2026-05-22-001-feat-object-window-commands-plan.md §7 for migration guidance."
  exit 1
fi

echo "OK: no deprecated symbols found"
