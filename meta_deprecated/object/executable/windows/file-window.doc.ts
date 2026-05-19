import type { Concept, DocNode } from "@meta/doc-types";
import * as file from "@src/executable/windows/file";

/**
 * file_window 概念：把文件正文按 lines/columns 切片引入 context。
 *
 * sources:
 *  - file — set_range / reload / edit / close 命令注册 + 文件读取、原子替换写盘
 */
export type FileWindowConcept = Concept & {
  sources: { file: typeof file };

  /** 关键字段（path / lines / columns 切片） */
  fields: DocNode;

  /** 4 个命令（set_range / reload / close / edit） */
  commands: {
    title: string;
    summary?: string;
    /** 调整 lines / columns 切片范围 */
    setRange: DocNode;
    /** 强制下一轮重新读文件 */
    reload: DocNode;
    /** 释放 file_window，不影响磁盘文件 */
    close: DocNode;
    /** 精确唯一字符串替换（含算法、失败模式、恢复指南、替代对比） */
    edit: {
      title: string;
      summary?: string;
      content?: string;
      /** applyEdits 顺序 4 步 */
      applyAlgorithm: {
        title: string;
        summary?: string;
        /** 从磁盘读 buffer，不复用渲染缓存 */
        step1ReadBuffer: DocNode;
        /** 顺序应用 edits，每次基于当前 buffer 唯一性校验 */
        step2SequentialReplace: DocNode;
        /** 全部成功才覆写文件 */
        step3WriteFile: DocNode;
        /** read/write IO 错误返回 [file_window.edit] 前缀 */
        step4IoErrorPath: DocNode;
      };
      /** 两类失败前缀都带 [file_window.edit] + 路径 */
      failureModes: {
        title: string;
        summary?: string;
        notFound: DocNode;
        matchesMultipleTimes: DocNode;
        currentBufferSemantics: DocNode;
      };
      /** LLM 错误恢复建议 */
      recoveryGuide: DocNode;
      /** 与 sed / write_file 等其它写文件方式的对比 */
      alternativesComparison: DocNode;
      /** 缺参数时的 input knowledge */
      inputKnowledge: DocNode;
    };
  };
};

export const file_window_v20260515_1: FileWindowConcept = {
  name: "FileWindow",
  sources: { file },
  description: `
file_window 把指定文件的正文（按可选 lines / columns 切片）作为持久 window 引入
context；由 root.open_file / root.write_file 创建。
`.trim(),

  fields: {
    title: "字段",
    summary: "path + lines / columns 切片",
    content: `
- path — 绝对路径；render 层每轮重新 readFile
- lines — 可选 [start, end] 切片
- columns — 可选 [start, end] 切片
- 渲染层在 renderFileWindowChildren 中按切片裁剪，32KB 截断
    `.trim(),
  },

  commands: {
    title: "命令面",
    summary: "file_window 注册 4 个 command",

    setRange: {
      title: "set_range",
      content: `
调整 lines / columns 切片范围。

参数：
- lines: 可选 [start, end]
- columns: 可选 [start, end]

执行：把 window 上的 lines/columns 覆盖为新值（缺省项保留原值）。
      `.trim(),
    },

    reload: {
      title: "reload",
      content: `
强制下一轮重新读文件。

- exec 体 no-op；render 层每轮都会重读
- 保留 command 主要是语义提示（文件被外部修改时 LLM 可显式触发）
      `.trim(),
    },

    close: {
      title: "close",
      content: `
释放本 file_window；不影响磁盘上的文件本身。exec 体 no-op；释放由 WindowManager 完成。
      `.trim(),
    },

    edit: {
      title: "edit",
      content: `
在 file_window 对应的文件上做"精确唯一字符串替换"。这是 OOC 修改已有文件的首选方式。

参数二选一：
- { old, new } — 单次替换
- { edits: [{old,new}, ...] } — atomic 多点替换（MultiEdit 风格）
      `.trim(),

      applyAlgorithm: {
        title: "applyAlgorithm（applyEdits）",
        summary: "顺序 4 步",

        step1ReadBuffer: {
          title: "step1ReadBuffer",
          content: `
从磁盘读 buffer（path = window.path），每次 edit 调用都重新读，不依赖渲染层缓存。
          `.trim(),
        },

        step2SequentialReplace: {
          title: "step2SequentialReplace",
          content: `
顺序应用每条 edit；每次替换的统计基于**当前 buffer**（已应用前 i-1 项之后），不是原始文件：

- 在当前 buffer 中统计 old 出现次数
- 必须**正好出现一次**；否则整组失败、不写盘
- 满足条件时 buffer = buffer.replace(old, new)

这是 Claude Code MultiEdit 的语义——让前置 edit 可以为后续 edit 制造唯一上下文。
          `.trim(),
        },

        step3WriteFile: {
          title: "step3WriteFile",
          content: `
全部成功 → writeFile 覆写 path（utf8）。任一前置失败时整组不写盘，避免半成品。
          `.trim(),
        },

        step4IoErrorPath: {
          title: "step4IoErrorPath",
          content: `
任何 read/write IO 错误 → 返回 [file_window.edit] <path>: <err> 作为 result；
走 commandExecLifecycle 的 legacyErrorPrefix 失败路径。
          `.trim(),
        },
      },

      failureModes: {
        title: "失败模式",
        summary: "两类失败前缀都带 [file_window.edit] + 文件路径，便于 LLM 解析",

        notFound: {
          title: "notFound",
          content: `
"edit #<i>: oldString not found"：old 在当前 buffer 中完全不存在（可能空白 / 引号 / 行尾差异）。
          `.trim(),
        },

        matchesMultipleTimes: {
          title: "matchesMultipleTimes",
          content: `
"edit #<i>: oldString matches N times (must match exactly once)"：old 出现 N 次（>1），
需扩展 old 上下文使其在当前 buffer 中唯一。
          `.trim(),
        },

        currentBufferSemantics: {
          title: "currentBufferSemantics",
          content: `
注意"当前 buffer"指**已应用前 i-1 项之后**，不是原始文件。这是 Claude Code MultiEdit 的语义，
前置 edit 可以为后续 edit 制造唯一上下文。
          `.trim(),
        },
      },

      recoveryGuide: {
        title: "recoveryGuide",
        content: `
收到 matches N times → 把 old 写得更长，包含前后几行使其在全文中唯一。
例：old: "count = 0" 全文 3 处 → 改成 old: "// 第一处计数初始化\\nconst count = 0" 只剩 1 处。

收到 not found → 用 reload 或重新查看 file_window 当前可见内容，确认实际字符串
（注意空白、引号、行尾），再 edit。

**反模式**：不要因为 edit 失败就改用 write_file 整文件覆盖——那等于放弃精确性。
扩大 old 上下文即可解决。
        `.trim(),
      },

      alternativesComparison: {
        title: "alternativesComparison",
        content: `
- 不要用 program(language="shell", code="sed -i ...") 改文件——容易踩转义陷阱、
  丢失 file_window 可见性、且无法表达 atomic 多点修改
- 不要用 write_file 做"修改局部"——write_file 是整文件覆盖语义（详见 root.write_file KNOWLEDGE）
        `.trim(),
      },

      inputKnowledge: {
        title: "inputKnowledge",
        content: `
formStatus==="open" 且 args 既不是 {old,new} 也不是非空 {edits:[...]} 时，
knowledge 表追加 key internal/windows/file/edit/input，提示二选一。
        `.trim(),
      },
    },
  },
};
