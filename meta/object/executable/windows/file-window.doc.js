import * as file from "@src/executable/windows/file";

/**
 * file_window 概念：把文件正文按 lines/columns 切片引入 context。
 *
 * sources:
 *  - file — set_range / reload / edit / close 命令注册 + 文件读取、原子替换写盘
 */
export const file_window_v20260515_1 = {
  name: "FileWindow",
  description: `file_window 把指定文件的正文（按可选 lines / columns 切片）作为持久 window 引入 context；由 root.open_file / root.write_file 创建。`,
  sources: { file },

  fields_v20260517_1: {
    index: `
关键字段：

- path — 绝对路径；render 层每轮重新 readFile
- lines — 可选 [start, end] 切片
- columns — 可选 [start, end] 切片
- 渲染层在 renderFileWindowChildren 中按切片裁剪，32KB 截断
`,
  },

  commands_v20260517_1: {
    index: `file_window 注册 4 个 command。`,

    setRange_v20260517_1: {
      index: `
### set_range

调整 lines / columns 切片范围。

参数：
- lines: 可选 [start, end]
- columns: 可选 [start, end]

执行：把 window 上的 lines/columns 覆盖为新值（缺省项保留原值）。
`,
    },

    reload_v20260517_1: {
      index: `
### reload

强制下一轮重新读文件。

- exec 体 no-op；render 层每轮都会重读
- 保留 command 主要是语义提示（文件被外部修改时 LLM 可显式触发）
`,
    },

    close_v20260517_1: {
      index: `
### close

释放本 file_window；不影响磁盘上的文件本身。exec 体 no-op；释放由 WindowManager 完成。
`,
    },

    edit_v20260517_1: {
      index: `
### edit

在 file_window 对应的文件上做"精确唯一字符串替换"。这是 OOC 修改已有文件的首选方式。

参数二选一：
- { old, new } — 单次替换
- { edits: [{old,new}, ...] } — atomic 多点替换（MultiEdit 风格）

详见各子节点：执行算法 edit.applyAlgorithm、失败模式 edit.failureModes、
LLM 错误恢复建议 edit.recoveryGuide、与其它写文件方式的对比 edit.alternativesComparison。
`,

      applyAlgorithm_v20260517_1: {
        index: `#### applyAlgorithm（applyEdits）— 顺序 4 步详见各子节点。`,

        step1ReadBuffer_v20260517_1: {
          index: `##### step1ReadBuffer — 从磁盘读 buffer（path = window.path），每次 edit 调用都重新读，不依赖渲染层缓存。`,
        },

        step2SequentialReplace_v20260517_1: {
          index: `
##### step2SequentialReplace

顺序应用每条 edit；每次替换的统计基于**当前 buffer**（已应用前 i-1 项之后），不是原始文件：

- 在当前 buffer 中统计 old 出现次数
- 必须**正好出现一次**；否则整组失败、不写盘
- 满足条件时 buffer = buffer.replace(old, new)

这是 Claude Code MultiEdit 的语义——让前置 edit 可以为后续 edit 制造唯一上下文。
`.trim(),
        },

        step3WriteFile_v20260517_1: {
          index: `##### step3WriteFile — 全部成功 → writeFile 覆写 path（utf8）。任一前置失败时整组不写盘，避免半成品。`,
        },

        step4IoErrorPath_v20260517_1: {
          index: `##### step4IoErrorPath — 任何 read/write IO 错误 → 返回 [file_window.edit] <path>: <err> 作为 result；走 commandExecLifecycle 的 legacyErrorPrefix 失败路径。`,
        },
      },

      failureModes_v20260517_1: {
        index: `两类失败前缀都带 [file_window.edit] + 文件路径，便于 LLM 解析；详见各子节点。`,

        notFound_v20260517_1: {
          index: `##### notFound — "edit #<i>: oldString not found"：old 在当前 buffer 中完全不存在（可能空白 / 引号 / 行尾差异）。`,
        },

        matchesMultipleTimes_v20260517_1: {
          index: `##### matchesMultipleTimes — "edit #<i>: oldString matches N times (must match exactly once)"：old 出现 N 次（>1），需扩展 old 上下文使其在当前 buffer 中唯一。`,
        },

        currentBufferSemantics_v20260517_1: {
          index: `##### currentBufferSemantics — 注意"当前 buffer"指**已应用前 i-1 项之后**，不是原始文件。这是 Claude Code MultiEdit 的语义，前置 edit 可以为后续 edit 制造唯一上下文。`,
        },
      },

      recoveryGuide_v20260517_1: {
        index: `
#### recoveryGuide

收到 matches N times → 把 old 写得更长，包含前后几行使其在全文中唯一。
例：old: "count = 0" 全文 3 处 → 改成 old: "// 第一处计数初始化\\nconst count = 0" 只剩 1 处。

收到 not found → 用 reload 或重新查看 file_window 当前可见内容，确认实际字符串
（注意空白、引号、行尾），再 edit。

**反模式**：不要因为 edit 失败就改用 write_file 整文件覆盖——那等于放弃精确性。
扩大 old 上下文即可解决。
`,
      },

      alternativesComparison_v20260517_1: {
        index: `
#### alternativesComparison

- 不要用 program(language="shell", code="sed -i ...") 改文件——容易踩转义陷阱、
  丢失 file_window 可见性、且无法表达 atomic 多点修改
- 不要用 write_file 做"修改局部"——write_file 是整文件覆盖语义（详见 root.write_file KNOWLEDGE）
`,
      },

      inputKnowledge_v20260517_1: {
        index: `
#### inputKnowledge

formStatus==="open" 且 args 既不是 {old,new} 也不是非空 {edits:[...]} 时，
knowledge 表追加 key internal/windows/file/edit/input，提示二选一。
`,
      },
    },
  },
};
