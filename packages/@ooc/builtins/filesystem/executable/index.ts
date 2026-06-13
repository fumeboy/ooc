/**
 * filesystem —— executable 维度。
 *
 * filesystem 是 agent 组合持有的 **tool-object 成员**：它把原先散在 root 上的文件操作方法
 * （grep/glob/open_file/write_file）收成一组连贯的 method 挂在 filesystem 对象上——这些方法已
 * **迁出 root**，root 不再承载文件操作。
 *
 * exec 经 `makeRootDelegator` 委托到 search / file constructor。这里独立声明方法壳（不 import
 * root 内部方法文件），是为了断开 root/executable barrel 的 import-期循环（barrel 在构造
 * ROOT_METHODS 时引用尚未初始化的 method 对象 → TDZ）。委托工厂在 exec 期才从 registry 查
 * constructor，本就为解耦而设。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";

// side-effect：确保被委托的 search / file constructor 已注册（与 root 方法文件同样的保险）。
import "@ooc/builtins/search";
import "@ooc/builtins/file";

// 缺参时的 refine-hint 文案——与原 root 同名方法逐字对齐，迁到成员对象后不丢 agent 引导。
const GREP_TIP = `grep 按文件内容 regex 搜索，结果作为 search_window。
参数：pattern（必填，regex）、path（可选，目录或文件）、glob（可选，文件名过滤）、case_insensitive（可选）。`;
const GLOB_TIP = `glob 按文件名通配符查找文件，结果作为 search_window。
参数：pattern（必填，glob 通配符，如 src/**/*.ts）、cwd（可选，搜索根目录）。`;
const OPEN_FILE_TIP = `open_file 把文件内容作为 file_window 引入 context。
参数：path（必填，文件路径）、lines（可选 [start,end]）、columns（可选 [start,end]）。`;
const WRITE_FILE_TIP = `write_file 整文件覆盖。用于新建文件或完整重写；改已有文件局部请用 file_window.edit。
参数：path（必填）、content（必填，完整文件内容，可为空串）。`;

// 各方法的 exec = 委托到对应 constructor。导出供测试直接驱动（filesystem 是这些方法的唯一注册家）。
export const grepExec = makeRootDelegator({ method: "grep", constructorKind: "search", objectLabel: "search_window", formMethod: "grep" });
export const globExec = makeRootDelegator({ method: "glob", constructorKind: "search", objectLabel: "search_window", formMethod: "glob" });
export const openFileExec = makeRootDelegator({ method: "open_file", constructorKind: "file", objectLabel: "file_window", formMethod: "open_file" });
export const writeFileExec = makeRootDelegator({ method: "write_file", constructorKind: "file", objectLabel: "file_window", formMethod: "write_file" });

const grepMethod: ObjectMethod = {
  description: "Search file contents by regex; results appear as a search window.",
  intents: ["grep"],
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "正则表达式" },
      path: { type: "string", required: false, description: "搜索根目录或单个文件" },
      glob: { type: "string", required: false, description: "文件名过滤 glob" },
      case_insensitive: { type: "boolean", required: false, description: "是否忽略大小写" },
    },
  },
  onFormChange(_change, { args }) {
    const hasPattern = typeof args.pattern === "string" && args.pattern.length > 0;
    return {
      tip: hasPattern ? `grepping for ${args.pattern}...` : GREP_TIP,
      intents: [{ name: "grep" }],
      quick_exec_submit: hasPattern,
    };
  },
  exec: grepExec,
};

const globMethod: ObjectMethod = {
  description: "Find files by glob pattern; results appear as a search window.",
  intents: ["glob"],
  schema: {
    args: {
      pattern: { type: "string", required: true, description: "glob 通配符" },
      cwd: { type: "string", required: false, description: "搜索根目录" },
    },
  },
  onFormChange(_change, { args }) {
    const hasPattern = typeof args.pattern === "string" && args.pattern.length > 0;
    return {
      tip: hasPattern ? `globbing ${args.pattern}...` : GLOB_TIP,
      intents: [{ name: "glob" }],
      quick_exec_submit: hasPattern,
    };
  },
  exec: globExec,
};

const openFileMethod: ObjectMethod = {
  description: "Open a file as a file window visible in context.",
  intents: ["open_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "文件路径（绝对，或相对 session baseDir）" },
      lines: { type: "array", required: false, description: "[start, end] 行范围" },
      columns: { type: "array", required: false, description: "[start, end] 列范围" },
    },
  },
  onFormChange(_change, { args }) {
    const hasPath = typeof args.path === "string" && args.path.length > 0;
    return {
      tip: hasPath ? `Opening file ${args.path}...` : OPEN_FILE_TIP,
      intents: [{ name: "open_file" }],
      quick_exec_submit: hasPath,
    };
  },
  exec: openFileExec,
};

const writeFileMethod: ObjectMethod = {
  description: "Write a file (full overwrite); spawns a file window pointing at the path.",
  intents: ["write_file"],
  schema: {
    args: {
      path: { type: "string", required: true, description: "目标文件路径" },
      content: { type: "string", required: true, description: "要写入的完整文件内容" },
    },
  },
  onFormChange(_change, { args }) {
    const ready = typeof args.path === "string" && args.path.length > 0 && typeof args.content === "string";
    return {
      tip: ready ? `Writing ${args.path}...` : WRITE_FILE_TIP,
      intents: [{ name: "write_file" }],
      quick_exec_submit: ready,
    };
  },
  exec: writeFileExec,
};

builtinRegistry.registerExecutable("filesystem", {
  methods: {
    grep: grepMethod,
    glob: globMethod,
    open_file: openFileMethod,
    write_file: writeFileMethod,
  },
});
