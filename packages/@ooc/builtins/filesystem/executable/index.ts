/**
 * filesystem —— executable 维度（object method）。
 *
 * filesystem 是 agent 组合持有的 **tool-object 成员**：它把文件操作方法
 * （grep/glob/open_file/write_file）收成一组连贯的 method 挂在 filesystem 对象上。
 *
 * 每个 method 是**委托类**：经 `ctx.runtime.instantiate(classId, args)` 造出对应子对象
 * （search / file），自身无业务态。返回提示文本告知 agent 子对象已造出。
 *
 * 注：旧契约的 `onFormChange`（refine-hint：`grepping for ...` 等动态引导文案 + quick_exec_submit）
 * 在新契约里无对应字段，逻辑暂以本文件局部常量保留（见各 *_TIP），等 core 反推阶段再决定归处。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/executable/contract.js";
import type { Data } from "../types.js";

// 子对象的 class id（委托目标；instantiate 经 ctx.runtime 在 exec 期解析其 constructor）。
const SEARCH_CLASS = "_builtin/search";
const FILE_CLASS = "_builtin/file";

// ── refine-hint 文案（旧 onFormChange 的缺参引导，保留语义；当前契约无 hook 槽位）──
const GREP_TIP = `grep 按文件内容 regex 搜索，结果作为 search 对象。
参数：pattern（必填，regex）、path（可选，目录或文件）、glob（可选，文件名过滤）、case_insensitive（可选）。`;
const GLOB_TIP = `glob 按文件名通配符查找文件，结果作为 search 对象。
参数：pattern（必填，glob 通配符，如 src/**/*.ts）、cwd（可选，搜索根目录）。`;
const OPEN_FILE_TIP = `open_file 把文件内容作为 file 对象引入 context。
参数：path（必填，文件路径）、lines（可选 [start,end]）、columns（可选 [start,end]）。`;
const WRITE_FILE_TIP = `write_file 整文件覆盖。用于新建文件或完整重写；改已有文件局部请用 file.edit。
参数：path（必填）、content（必填，完整文件内容，可为空串）。`;

function requireRuntime(ctx: ExecutableContext, method: string) {
  if (!ctx.runtime) {
    throw new Error(`[filesystem.${method}] 缺少 runtime 句柄，无法实例化子对象`);
  }
  return ctx.runtime;
}

const grepMethod: ObjectMethod<Data> = {
  name: "grep",
  description: "Search file contents by regex; results appear as a search object.",
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "正则表达式" },
      path: { type: "string", required: false, description: "搜索根目录或单个文件" },
      glob: { type: "string", required: false, description: "文件名过滤 glob" },
      case_insensitive: { type: "boolean", required: false, description: "是否忽略大小写" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return GREP_TIP;
    const runtime = requireRuntime(ctx, "grep");
    await runtime.instantiate(SEARCH_CLASS, {
      pattern,
      path: args.path,
      glob: args.glob,
      case_insensitive: args.case_insensitive,
      mode: "grep",
    });
    return `opened search (grep) for ${pattern}`;
  },
};

const globMethod: ObjectMethod<Data> = {
  name: "glob",
  description: "Find files by glob pattern; results appear as a search object.",
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "glob 通配符" },
      cwd: { type: "string", required: false, description: "搜索根目录" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) return GLOB_TIP;
    const runtime = requireRuntime(ctx, "glob");
    await runtime.instantiate(SEARCH_CLASS, {
      glob: pattern,
      cwd: args.cwd,
      mode: "glob",
    });
    return `opened search (glob) for ${pattern}`;
  },
};

const openFileMethod: ObjectMethod<Data> = {
  name: "open_file",
  description: "Open a file as a file object visible in context.",
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（绝对，或相对 session baseDir）" },
      lines: { type: "array", required: false, description: "[start, end] 行范围" },
      columns: { type: "array", required: false, description: "[start, end] 列范围" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return OPEN_FILE_TIP;
    const runtime = requireRuntime(ctx, "open_file");
    await runtime.instantiate(FILE_CLASS, {
      path,
      lines: args.lines,
      columns: args.columns,
    });
    return `opened file ${path}`;
  },
};

const writeFileMethod: ObjectMethod<Data> = {
  name: "write_file",
  description: "Write a file (full overwrite); spawns a file object pointing at the path.",
  schema: {
    args: {
      path: { type: "string", required: true, description: "目标文件路径" },
      content: { type: "string", required: true, description: "要写入的完整文件内容" },
    },
  },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const path = typeof args.path === "string" ? args.path : "";
    const hasContent = typeof args.content === "string";
    if (!path || !hasContent) return WRITE_FILE_TIP;
    const runtime = requireRuntime(ctx, "write_file");
    await runtime.instantiate(FILE_CLASS, {
      path,
      content: args.content,
    });
    return `wrote file ${path}`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [grepMethod, globMethod, openFileMethod, writeFileMethod],
};

export default executable;
