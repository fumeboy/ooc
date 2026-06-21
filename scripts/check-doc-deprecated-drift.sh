#!/usr/bin/env bash
# scripts/check-doc-deprecated-drift.sh
#
# 常设检查：防「废弃符号/概念在设计文档里没回流」漂移复发。
#
# 背景：`check-no-deprecated-symbols.sh` 扫**源码**（packages/@ooc + scripts）防旧符号回流；
# 但 2026-06-11 多轮抽查发现，符号/字段退役时，散落在**对象树设计文档**（.ooc-world-meta）
# 与 **builtin agent-facing knowledge**（packages/@ooc/builtins/**/{knowledge,self.md,readable.md}）
# 里的引用没被一并回流——文档继续把已废 API 当 live 教（如 ui_methods / basicKnowledge /
# renderXml 字段 / export const object / 已删的 session-merge 符号 / 已不存在的 core/programmable
# 路径）。本脚本专扫这两片文档，命中即 fail。
#
# 关键设计：文档**合法地解释退役**（"X 已废"/"renderXml 已并入 readable"），所以
# 命中行若含「退役标记词」（已废/废弃/退役/已删/已移除/已并入/不存在/不再/取代/旧名/非正式/非独立
# / `→`）即视为解释、放行。只有把废弃概念当 live 教（无标记）才算 drift。
#
# 退役一个符号/概念后的回流流程（checklist）：
#   1. 在 FORBIDDEN_PATTERNS 加它的**精确**模式（别用 knowledge / object 这类常用词裸 grep）。
#   2. 跑本脚本，按报告逐处把文档里「当 live 教」改成新机制（或加退役标记说明）。
#   3. 源码侧的硬切防回退仍由 check-no-deprecated-symbols.sh 管。
#
# 使用：bash scripts/check-doc-deprecated-drift.sh  （推荐挂 verify / pre-push）

set -e

# 扫描根：对象树设计文档 + builtin agent-facing 文档。
SCAN_PATHS=(
  ".ooc-world-meta/stones/main/objects"
  "packages/@ooc/builtins"
)

# 只扫 agent-facing / 设计文档（.md），不扫源码（.ts 由 check-no-deprecated-symbols.sh 管）。
# 退役的**精确**模式（避免 knowledge/object 等常用词误报）。新增退役符号往这加。
declare -a FORBIDDEN_PATTERNS=(
  # —— executable/readable schema 维度退役（2026-06-11）——
  "export const ui_methods"
  "loadUiMethods"
  "export const llm_methods"
  "export const object\\b"          # executable 应是 export const window
  "basicKnowledge:"                  # type 级协议知识字段退役
  "renderXml:"                       # 并入 readable，非独立字段
  # —— reflectable session-merge 模型退役（2026-06-11）——
  "tryMergeSelf"
  "evolveSelfMerge"
  "evolveSelfDiff"
  "requestPrIssueReview"
  "classifyDiffAgainstMain"
  "classifyWorktreeBranch"
  "stone-evolve-self"
  # —— 已不存在的 core/programmable 目录（机制寄居 persistable）——
  "core/programmable/"
  "@ooc/core/programmable/"
  # —— ObjectTypeRegistrar / per-world WorldRuntime.objects 死表退役（2026-06-12，L1）——
  # 真正运转的是渲染期 object-windows.ts lazy ensure 进全局 builtinRegistry。
  "ObjectTypeRegistrar"
  "object-type-registrar"
  "WorldRuntime\\.objects"
  # —— 4 原语 / compress-是-tool 旧表述退役（2026-06-14）——
  # 终态：稳定原语恒为 3 个 exec/close/wait；compress 是经 exec 调的 window method、非原语。
  # 注意：「四件套」在 class 维度专指 builtin 五件套文件形态，不在此处禁（勿裸 grep 该词）。
  "4 个基础 tool"
  "4 个稳定 tool 原语"
  "4 个稳定接口"
  "exec/close/wait/compress"
  "OOC_TOOLS = \\[EXEC, CLOSE, WAIT, COMPRESS\\]"
  "compress 是 tool"
  "compress 元 tool"
  "compress.*元 tool"
  # —— do→talk 合并退役（2026-06-14，Inc B）——
  # 终态：do 方法 / do_window class / continue / move 并入 talk（target=自己 ⇒ fork 子线程）/ say / share。
  # do_window / do_window.continue / do_window.move 作为 live API 教即 drift；引用模式
  # sharing kind 旧字面量 ref/lent_out 也退役为 readonly-ref/mutable-ref。
  "do_window"
  "do_window\\.continue"
  "do_window\\.move"
  "creator do_window"
  "creator_do_window"
  # do 作为 live agency 动词（活的 agency 是 talk/plan/todo/end）；迁移注释"旧 do 并入"用 → / 并入 标记豁免
  "agency（do"
  "do/talk/plan"
  "do\\.continue"
  'kind="ref"'
  'kind="lent_out"'
  '"lent_out"'
  "sharing.*lent_out"
  # —— compress v2（resize/compress 协议，2026-06-21）退役 v1 方法面 ——
  # 终态：compress 是协议（class 自实现、无默认）；resize 设档位（替代 expand）+ compress 无参意图；
  # 摘要由 summarizer fork 生成。下列 v1 表述当 live 教即 drift（迁移表用 退役/→ 标记豁免）。
  "scope=events"
  "scope=windows"
  "scope=auto"
  "threadExpand"
  "compress\\(scope"
  "compress.*两 scope"
  # —— object 激活生命周期（active/unactive 经引用计数，2026-06-21）退役旧 close-method / destruct 面 ——
  # 终态：thread close 是 tool 原语（移引用）非 thread object method；删除是 unactive 返回 {delete} 自决、
  # 无独立 destruct 钩子。下列退役符号当 live 教即 drift（迁移说明用 退役/→/已删 标记豁免）。
  # 精确到符号——不宽匹配 close（terminal/interpreter/plan/file/search 的 close object method 仍是 live API）。
  "archiveForkChild"
  "ObjectDestructor"
  "destruct\\?:"
)

# 退役标记词：命中行含其一 = 合法的「退役说明」，放行。
ALLOW_MARKER='已废|废弃|退役|已删|已移除|已并入|不存在|不再|无独立|无 `|取代|旧名|旧 |非正式|非独立|抛错|命中即|→|deprecated'

VIOLATIONS=0
for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # line 形如 path:lineno:content；取 content 判退役标记。
    content="${line#*:*:}"
    if echo "$content" | grep -qE "$ALLOW_MARKER"; then
      continue   # 退役说明，放行
    fi
    if [[ $VIOLATIONS -eq 0 ]]; then
      echo "[FAIL] 设计文档把已废符号/概念当 live 教（未带退役标记）："
    fi
    echo "  /$pattern/  $line"
    VIOLATIONS=$((VIOLATIONS + 1))
  done < <(grep -rnE "$pattern" "${SCAN_PATHS[@]}" --include="*.md" 2>/dev/null || true)
done

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Found $VIOLATIONS doc-drift violation(s)."
  echo "把这些文档处的废弃概念改成当前机制；若是退役说明，行内加退役标记词。"
  echo "退役新符号 → 往 FORBIDDEN_PATTERNS 加精确模式（见脚本头 checklist）。"
  exit 1
fi

echo "OK: no deprecated-concept drift in design docs"
