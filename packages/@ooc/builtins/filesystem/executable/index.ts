/**
 * filesystem —— executable 维度。
 *
 * filesystem 是 agent 组合持有的 **tool-object 成员**：它把散在 root 上的文件操作方法
 * （grep/glob/open_file/write_file）收成一组连贯的 method 挂在 filesystem 对象上。
 *
 * exec 经 `makeRootDelegator` 委托到 search / file constructor —— 与 root 同名方法**同一条
 * 委托链、行为一致**。这里独立声明方法壳（不 import root 内部方法文件），是为了断开
 * root/executable barrel 的 import-期循环（barrel 在构造 ROOT_METHODS 时引用尚未初始化的
 * method 对象 → TDZ）。委托工厂在 exec 期才从 registry 查 constructor，本就为解耦而设。
 *
 * 注：root 上的同名方法本 increment 仍保留（纯加法、过渡态），不拆 root。
 */
import type { ObjectMethod } from "@ooc/core/extendable/_shared/method-types.js";
import { makeRootDelegator } from "@ooc/builtins/_shared/executable/delegator.js";
import { builtinRegistry } from "@ooc/core/extendable/_shared/registry.js";

// side-effect：确保被委托的 search / file constructor 已注册（与 root 方法文件同样的保险）。
import "@ooc/builtins/search";
import "@ooc/builtins/file";

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
    return { intents: [{ name: "grep" }], quick_exec_submit: hasPattern };
  },
  exec: makeRootDelegator({ method: "grep", constructorKind: "search", objectLabel: "search_window", formMethod: "grep" }),
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
    return { intents: [{ name: "glob" }], quick_exec_submit: hasPattern };
  },
  exec: makeRootDelegator({ method: "glob", constructorKind: "search", objectLabel: "search_window", formMethod: "glob" }),
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
    return { intents: [{ name: "open_file" }], quick_exec_submit: hasPath };
  },
  exec: makeRootDelegator({ method: "open_file", constructorKind: "file", objectLabel: "file_window", formMethod: "open_file" }),
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
    return { intents: [{ name: "write_file" }], quick_exec_submit: ready };
  },
  exec: makeRootDelegator({ method: "write_file", constructorKind: "file", objectLabel: "file_window", formMethod: "write_file" }),
};

builtinRegistry.registerExecutable("filesystem", {
  methods: {
    grep: grepMethod,
    glob: globMethod,
    open_file: openFileMethod,
    write_file: writeFileMethod,
  },
});
