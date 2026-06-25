/**
 * filesystem —— executable 维度（object method）。
 *
 * filesystem 是 agent 组合持有的 **tool-object 成员**：它把文件操作方法
 * （grep/glob/open_file/write_file）收成一组连贯的 method 挂在 filesystem 对象上。
 *
 * 每个 method 是**委托类**：经 `ctx.runtime.instantiate(classId, args)` 造出对应子对象
 * （search / file），自身无业务态。返回提示文本告知 agent 子对象已造出。
 *
 * 缺必填参的引导由各 method `schema` 的 `required` + `description` 表达（不再有 onFormChange hook）。
 */

import type {
  ExecutableContext,
  ObjectMethod,
  ExecutableModule,
} from "@ooc/core/types";
import type { Data } from "../types.js";

// 子对象的 class id（委托目标；instantiate 经 ctx.runtime 在 exec 期解析其 constructor）。
const SEARCH_CLASS = "_builtin/filesystem/search";
const FILE_CLASS = "_builtin/filesystem/file";

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
      pattern: { type: "string", required: true, description: "正则表达式" },
      path: { type: "string", required: false, description: "搜索根目录或单个文件" },
      glob: { type: "string", required: false, description: "文件名过滤 glob" },
      case_insensitive: { type: "boolean", required: false, description: "是否忽略大小写" },
    },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) throw new Error("[filesystem.grep] 缺少必填参数 pattern");
    const runtime = requireRuntime(ctx, "grep");
    await runtime.instantiate({ class: SEARCH_CLASS, args: {
      pattern,
      path: args.path,
      glob: args.glob,
      case_insensitive: args.case_insensitive,
      mode: "grep",
    }});
    return `opened search (grep) for ${pattern}`;
  },
};

const globMethod: ObjectMethod<Data> = {
  name: "glob",
  description: "Find files by glob pattern; results appear as a search object.",
  schema: {
      pattern: { type: "string", required: true, description: "glob 通配符" },
      cwd: { type: "string", required: false, description: "搜索根目录" },
    },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) throw new Error("[filesystem.glob] 缺少必填参数 pattern");
    const runtime = requireRuntime(ctx, "glob");
    // glob 通配符走 search 的 `pattern` 入参（glob 字段是 grep 的文件名过滤器，语义不同）；
    // 显式 mode="glob" 让 search 构造器走 glob 分支。
    await runtime.instantiate({
      class: SEARCH_CLASS, args: {
        pattern,
        cwd: args.cwd,
        mode: "glob",
      }
    });
    return `opened search (glob) for ${pattern}`;
  },
};

const openFileMethod: ObjectMethod<Data> = {
  name: "open_file",
  description: "Open a file as a file object visible in context.",
  schema: {
      path: { type: "string", required: true, description: "文件路径（绝对，或相对 session baseDir）" },
      lines: { type: "array", required: false, description: "[start, end] 行范围" },
      columns: { type: "array", required: false, description: "[start, end] 列范围" },
    },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) throw new Error("[filesystem.open_file] 缺少必填参数 path");
    const runtime = requireRuntime(ctx, "open_file");
    await runtime.instantiate({
      class: FILE_CLASS, args: {
        path,
        lines: args.lines,
        columns: args.columns,
      }
    });
    return `opened file ${path}`;
  },
};

const writeFileMethod: ObjectMethod<Data> = {
  name: "write_file",
  description: "Write a file (full overwrite); spawns a file object pointing at the path.",
  schema: {
      path: { type: "string", required: true, description: "目标文件路径" },
      content: { type: "string", required: true, description: "要写入的完整文件内容" },
    },
  exec: async (ctx: ExecutableContext, _self: Data, args: Record<string, unknown>) => {
    const path = typeof args.path === "string" ? args.path : "";
    const hasContent = typeof args.content === "string";
    if (!path || !hasContent) throw new Error("[filesystem.write_file] 缺少必填参数 path/content");
    const runtime = requireRuntime(ctx, "write_file");
    await runtime.instantiate({
      class: FILE_CLASS,
      args: {
        path,
        content: args.content,
      }
    });
    return `wrote file ${path}`;
  },
};

const executable: ExecutableModule<Data> = {
  methods: [grepMethod, globMethod, openFileMethod, writeFileMethod],
};

export default executable;
