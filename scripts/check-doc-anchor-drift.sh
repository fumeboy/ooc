#!/usr/bin/env bash
# scripts/check-doc-anchor-drift.sh
#
# 常设检查：防设计文档里的源码锚点 `path/file.ts:行号` 指向**死文件**或**越界行号**。
#
# 背景：2026-06-12 全树文档审计发现，文档锚点最大宗的漂移是行号随源码重构偏移，
# 其中最严重的两类是「锚定文件从未存在/已改名」（basic-knowledge.ts、synthesizer.ts）
# 与「文件缩短后行号越界」（method_exec/index.ts:53 但该文件仅 32 行）。这两类把读者
# 直接导向不存在的位置。本脚本把它们挡在 CI。
#
# 关键设计——只验**两件零误报的事**：
#   1. 锚定的 .ts/.tsx 文件存在。
#   2. 行号 ≤ 文件总行数（不越界）。
# **不做**符号级配对（提取锚点旁反引号符号、验证它在 file:行号±容差处）：文档里锚点
# 旁的反引号多是概念名/method 名而非该行的导出符号（如 `tools/index.ts:28` 旁并不写
# OOC_TOOLS；一行常并列 6+ 锚点无法可靠配对），强行配对会高误报、污染 gate 的可信度。
# 小幅行号偏移（:113 实际 :115）本脚本**有意不抓**——导航仍到邻近，危害小，抓它必引噪音。
# 退役符号回流由 check-doc-deprecated-drift.sh 管，本脚本只管锚点物理可达性。
#
# 使用：bash scripts/check-doc-anchor-drift.sh  （推荐挂 verify / pre-push）

set -e

# 扫描根：对象树设计文档 + builtin agent-facing 文档（与 doc-drift 一致）。
SCAN_PATHS=(
  ".ooc-world-meta/stones/main/objects"
  "packages/@ooc/builtins"
)

# 锚点形态：packages/@ooc/<路径>.ts:行号 或 .tsx:行号；范围 :N-M 取起始 N。
# 路径用合法字符白名单，自然在反引号/括号/中文标点/空格处终止。
#
# **`~~strikethrough~~` 显式跳过**：极简化重构期把退役模块的死锚标记为 `~~path:N~~`，本脚本
# 跳过这些已知 stale 标记——意图明确：这是"待重建"标识、不是"行号偏移"漂移。
ANCHOR_RE='packages/@ooc/[A-Za-z0-9_./@-]+\.tsx?:[0-9]+'

DEAD_FILE=0
OUT_OF_RANGE=0
VIOLATIONS=0

while IFS= read -r hit; do
  [[ -z "$hit" ]] && continue
  # hit 形如 docfile:docline:packages/@ooc/.../file.ts:N（anchor 自身含 ':'）
  docloc="${hit%%:packages/@ooc/*}"          # docfile:docline
  anchor="packages/@ooc/${hit#*:packages/@ooc/}"
  file="${anchor%:*}"
  line="${anchor##*:}"

  if [[ ! -f "$file" ]]; then
    if [[ $VIOLATIONS -eq 0 ]]; then echo "[FAIL] 文档源码锚点不可达："; fi
    echo "  死文件   $docloc  →  $anchor"
    DEAD_FILE=$((DEAD_FILE + 1)); VIOLATIONS=$((VIOLATIONS + 1))
    continue
  fi
  total=$(wc -l < "$file")
  total=$((total + 1))                        # 末行无换行符时 wc -l 少计 1，宽松 +1
  if (( line > total )); then
    if [[ $VIOLATIONS -eq 0 ]]; then echo "[FAIL] 文档源码锚点不可达："; fi
    echo "  越界行号 $docloc  →  $anchor （文件仅 $((total - 1)) 行）"
    OUT_OF_RANGE=$((OUT_OF_RANGE + 1)); VIOLATIONS=$((VIOLATIONS + 1))
  fi
done < <(
  # `~~packages/@ooc/...~~` 强制跳过（极简化重构期把退役模块的死锚标记为 `~~path:N~~`，
  # 意图明确：是"待重建"标识、不是"行号偏移"漂移）。
  grep -rnE "$ANCHOR_RE" "${SCAN_PATHS[@]}" --include="*.md" 2>/dev/null \
    | grep -v '~~packages/@ooc/' \
    | grep -oE "[^:]+:[0-9]+:.*" \
    | while IFS= read -r full; do
        # extract just docfile:docline:anchor (re-do oE-equivalent: keep first anchor per line)
        anchor=$(echo "$full" | grep -oE "$ANCHOR_RE" | head -1)
        [[ -z "$anchor" ]] && continue
        docloc="${full%%:packages/@ooc/*}"
        echo "${docloc}:${anchor}"
      done
)

if [[ $VIOLATIONS -gt 0 ]]; then
  echo
  echo "Found $VIOLATIONS anchor-drift violation(s) [dead-file=$DEAD_FILE out-of-range=$OUT_OF_RANGE]."
  echo "把锚点改到真实文件:行号（优先锚 export const / 函数名所在行）。"
  exit 1
fi

echo "OK: no anchor drift（all source anchors point to existing files & in-range lines）"
