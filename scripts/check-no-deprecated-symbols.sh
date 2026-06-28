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
  # OPEN_TOOL：issue E 重新引入 `open` 为 4 个 tool 原语之一（exec/close/wait/open），
  # 是当前合法符号（packages/@ooc/builtins/agent/children/thread/thinkable/tools/schema.ts:53），
  # 不再禁。REFINE_TOOL / SUBMIT_TOOL / handle{Open,Refine,Submit}Tool 早 D6 退役，源码内已无引用，
  # 留作回潮护栏。
  "REFINE_TOOL"
  "SUBMIT_TOOL"
  "handleOpenTool"
  "handleRefineTool"
  "handleSubmitTool"
  "runCallCommandProgram"
  "program\\.callCommand"
  # —— ObjectTypeRegistrar / per-world objects 死表退役（2026-06-12，L1：死表无 think/exec 读取方）——
  "ObjectTypeRegistrar"
  "createObjectTypeRegistrar"
  "typeRegistration"
  # —— readme.md 退役（2026-06-12）：legacy readable.md 前身，端点/字段/磁盘文件名全迁 readable。
  #    精确小写 `readme\.md`，不命中根 README.md（大写，grep 默认大小写敏感）。
  "readme\\.md"
  # —— thread container indirection 退役（2026-06-16）：thread 持久化改标准 persistable.save/load，
  #    删 PersistableModule.container / ThreadContainerPersistence / threadContainer。
  "ThreadContainerPersistence"
  "\\bthreadContainer\\b"
  # —— isCreatorWindow 去状态化（2026-06-16）：creator 窗身份编码在 id，不存 data flag。
  #    精确禁「字段重声明」isCreatorWindow?:（不命中 .isCreatorWindow 访问）。
  "isCreatorWindow\\?:"
  # —— creator 窗概念退役 → thread 窗（compress Case A 载体收敛，2026-06-20）：一条 thread 恰好一个
  #    thread 窗（过程），creator 对话是其内建上游通道、非独立窗。符号改名（id 字符串 w_creator_ 保留）：
  #    creatorWindowIdOf→threadWindowIdOf / isCreatorWindowId→isSelfThreadWindow /
  #    CREATOR_WINDOW_ID_PREFIX→THREAD_WINDOW_ID_PREFIX。禁旧名防回潮。
  "creatorWindowIdOf"
  "isCreatorWindowId"
  "CREATOR_WINDOW_ID_PREFIX"
  # —— compress v2（resize 协议，2026-06-21）：compress=无参折叠意图 / resize=档位（替代 expand），
  #    无通用默认窗方法表。退役：通用默认表 default-window-methods（resolveDefaultWindowMethod /
  #    DEFAULT_WINDOW_METHODS）、expand 窗方法（threadExpand）、agent 给 scope/keepTail/summary 的
  #    旧 compress（foldEvents helper）。禁精确符号防回潮（不命中 storybook 的「default-window-methods 已删」说明串）。
  "resolveDefaultWindowMethod"
  "DEFAULT_WINDOW_METHODS"
  "threadExpand"
  "\\bfoldEvents\\b"
  # expand 窗方法已退役（resize 替代）：禁 agent-facing affordance 串 `method=expand`（\\b 不命中 expand_step 等）。
  "method=expand\\b"
  "method=\\\"expand\\\""
  # displayResize 共享实现已删（2026-06-21）：各内容窗各自实现 resize、无共享默认 const。
  "displayResize"
  # —— 对象生命周期重构（2026-06-21）：dead destruct 槽复用为 active?/unactive?（refcount 0↔1）。
  #    退役符号防回潮（注：thread close 方法虽退役，但 closeMethod 是众 builtin 的通用局部名、
  #    不可作精确禁；其退役由 fork-unactive/tools 测试 + 设计文档守）：
  "ObjectDestructor"
  "destruct\\?:"
  "\\barchiveForkChild\\b"
  # —— object data 落盘统一 data.json，退役 state.json（2026-06-21）：默认持久化文件名 state.json→data.json
  #    （裸 data 替信封），interpreter getData/setData 收紧为本实例 userData（删 flow-data session 草稿）。
  #    退役符号 + 落盘字面量防回潮（精确小写 `state\.json`，不命中大写 STATE / 无关词）：
  "writeRuntimeObjectState"
  "readRuntimeObjectState"
  "runtimeObjectStateFile"
  "flowDataFile"
  "state\\.json"
)

# 允许列表（D6 硬切的合法引用点 + 概念文档）
ALLOW_LIST=(
  "packages/@ooc/core/runtime/server-loader.ts"
  "packages/@ooc/core/executable/server/window-types.ts"
  "packages/@ooc/core/executable/server/types.ts"
  "packages/@ooc/core/executable/__tests__/server-loader.test.ts"
  "packages/@ooc/core/executable/windows/_shared/command-types.ts"  # 历史变更说明注释
  "packages/@ooc/builtins/supervisor/knowledge/creating-objects.md"  # 建对象 knowledge 教「别写 llm_methods」需引用该字面量
  "scripts/check-no-deprecated-symbols.sh"
  "scripts/check-doc-deprecated-drift.sh"  # 文档漂移检查的 FORBIDDEN_PATTERNS 列了这些废弃符号字面量
  "packages/@ooc/core/persistable/__tests__/stone.test.ts"  # 守门断言：writeReadable 不再写 readme.md，须引用该字面量
  "packages/@ooc/builtins/agent/children/thread/TODO.md"  # 计划文档：记述 container/ThreadContainerPersistence 退役过程，须引用字面量
  "scripts/migrate-state-context-split.ts"  # 一次性历史数据迁移脚本：按定义操作旧 state.json 布局，须引用旧字面量
  "scripts/__tests__/migrate-state-context-split.test.ts"  # 上述迁移脚本的测试，同样引用旧 state.json 布局
)

EXCLUDE_DIRS=(
  "node_modules"
  ".git"
  ".ooc-world"
  ".ooc-world-test"
  "docs"  # plan 文件、归档 spec 内的描述合法
  "dist"  # web 构建产物（minified bundle，含第三方 hast/rehype 字面量），非源码
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
