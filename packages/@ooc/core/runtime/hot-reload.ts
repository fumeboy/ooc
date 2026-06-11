/**
 * HotReloadWatcher — dev 模式下的 stone 文件变更监听。
 *
 * 监听 World 内 stones （含 deprecated packages/ fallback）的源码变更，
 * 去抖聚类后通过 StoneRegistry 派发 `stone:changed` 事件。
 *
 * 设计要点：
 * - 递归 fs.watch（recursive=true）覆盖整个 stones/ 树。
 * - 50ms debounce：编辑器保存往往触发多个 rename + change 事件，聚合成一次派发。
 * - 聚类单位 = objectId：同一 stone 的多个文件变更合并为一条事件。
 * - 变更按 kind 分类：code / view / knowledge / identity（复用 StoneRegistry.classifyChange）。
 * - 只在 dev 模式启用；生产模式不启动，避免多余的 inotify 句柄。
 */
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, relative, sep } from "node:path";
import { STONE_OBJECTS_SUBDIR } from "../persistable/common.js";
import type { StoneChangedEvent, StoneRegistry } from "./stone-registry.js";

/** 被视为 identity 变更的文件名集合（影响 Object 身份/契约）。 */
const IDENTITY_FILES = new Set(["self.md", "readable.md", "readable.ts", "package.json"]);

/** 被视为 knowledge 变更的子目录名。 */
const KNOWLEDGE_DIR = "knowledge";

/** 被视为 view 变更的子目录名（visible/ + 旧别名 client/）。 */
const VISIBLE_DIRS = new Set(["visible", "client"]);

/** 被视为 code 变更的子目录名（executable/ + 旧别名 server/）。 */
const CODE_DIRS = new Set(["executable", "server"]);

export interface HotReloadWatcher {
  /** 停止监听，释放 fs watcher。 */
  stop(): void;
}

export interface HotReloadOptions {
  /** debounce 窗口（毫秒）。默认 50ms。 */
  debounceMs?: number;
}

/**
 * 从一个变更文件的绝对路径推断对应的 stone objectId 以及变更分类。
 *
 * 扫描策略（对齐 StoneRegistry）：
 * 1. 若路径落在 `{worldPath}/stones/` 下：
 *    - 顶层 dir 是 objectId；遇到 `children/` marker 后下一段也是 objectId segment。
 *    - children/ marker 之前的所有 segment 组成 objectId。
 * 2. 若路径落在 `{worldPath}/packages/` 下（deprecated），规则同上。
 *
 * 返回 null = 该文件不在任何 stone 定义目录内（例如 stones/ 根本身的变更，
 * 或 stones/<id>/database/ 等不受热更新影响的路径）。
 */
export function parseStoneChange(
  worldPath: string,
  absFilePath: string,
): { objectId: string; kind: StoneChangedEvent["kind"] } | null {
  const rel = relative(worldPath, absFilePath);
  if (!rel || rel.startsWith("..")) return null;

  const parts = rel.split(sep);
  if (parts.length < 2) return null;

  const root = parts[0];
  if (root !== "stones" && root !== "packages") return null;

  // 提取 objectId segments：支持两种布局
  //   Flat:        stones/<id>/...
  //   Versioning:  stones/<branch>/objects/<id>/...
  const idSegments: string[] = [];
  let i = 1;
  // 检测并跳过 versioning 前缀: <branch>/objects/
  if (parts.length >= 3 && parts[2] === STONE_OBJECTS_SUBDIR && !parts[1].startsWith(".") && !parts[1].startsWith("@")) {
    i = 3;
  }
  while (i < parts.length) {
    const seg = parts[i];
    if (!seg || seg.startsWith(".")) break;
    // children/ marker 本身不是 objectId 的一部分，但下一段是
    if (seg === "children") {
      i += 1;
      if (i >= parts.length) break;
      const childSeg = parts[i];
      if (!childSeg || childSeg.startsWith(".")) break;
      idSegments.push(childSeg);
      i += 1;
      continue;
    }
    // 跳过保留目录 @ooc/ 之类
    if (seg.startsWith("@")) break;
    idSegments.push(seg);
    i += 1;
    break; // 顶层 stone 只有一段（嵌套通过 children/）
  }

  if (idSegments.length === 0) return null;

  // 路径剩余部分（石头目录内的相对路径）用来分类
  const remaining = parts.slice(i);
  const kind = classifyRemaining(remaining);
  if (kind === null) return null;

  return { objectId: idSegments.join("/"), kind };
}

function classifyRemaining(remaining: string[]): StoneChangedEvent["kind"] | null {
  if (remaining.length === 0) return null;
  const fileName = basename(remaining.join(sep));

  if (IDENTITY_FILES.has(fileName)) {
    if (fileName === "readable.md") return "knowledge";
    if (fileName === "readable.ts") return "code";
    return "identity";
  }

  if (remaining.length >= 2) {
    const stoneSubDir = remaining[0];
    if (stoneSubDir === KNOWLEDGE_DIR) return "knowledge";
    if (VISIBLE_DIRS.has(stoneSubDir)) return "view";
    if (CODE_DIRS.has(stoneSubDir)) return "code";
  }

  // 不认识的路径：不触发热更新
  return null;
}

/**
 * 启动 hot-reload watcher。
 *
 * 返回一个 stop 句柄；WorldRuntime.dispose() 会调用它。
 * 所有文件变更经 debounce 聚类后，通过 `registry.invalidate(objectId, files)` 派发，
 * 自动触发 registry 的 stone:changed 事件流。
 */
export function startHotReloadWatcher(
  worldPath: string,
  registry: StoneRegistry,
  opts: HotReloadOptions = {},
): HotReloadWatcher {
  const debounceMs = opts.debounceMs ?? 50;

  // key = objectId, value = Set<changedFiles>
  const pending = new Map<string, Set<string>>();
  let debounceTimer: Timer | null = null;

  function flush(): void {
    debounceTimer = null;
    for (const [objectId, files] of pending) {
      void registry.invalidate(objectId, Array.from(files));
    }
    pending.clear();
  }

  function scheduleFlush(): void {
    if (debounceTimer != null) return;
    debounceTimer = setTimeout(flush, debounceMs);
  }

  function handleChange(absPath: string): void {
    const parsed = parseStoneChange(worldPath, absPath);
    if (!parsed) return;
    let bucket = pending.get(parsed.objectId);
    if (!bucket) {
      bucket = new Set();
      pending.set(parsed.objectId, bucket);
    }
    bucket.add(absPath);
    scheduleFlush();
  }

  const watchers: FSWatcher[] = [];
  for (const sub of ["stones", "packages"]) {
    try {
      const w = watch(
        `${worldPath}/${sub}`,
        { persistent: false, recursive: true },
        (_event, filename) => {
          if (!filename) return;
          // On macOS fs.watch(recursive) gives us the relative path from watch root.
          // Normalize to absolute.
          const abs = `${worldPath}/${sub}/${filename}`;
          handleChange(abs);
        },
      );
      w.on("error", () => {
        // 忽略 watcher 错误（目录被删除等 transient 情况）。
        // 目录重建时 OS 不会自动重启 watcher，但开发期重启 ooc dev 即可接受。
      });
      watchers.push(w);
    } catch {
      // ENOENT 等——stones/ 或 packages/ 目录不存在。静默忽略。
    }
  }

  return {
    stop() {
      if (debounceTimer != null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // ignore
        }
      }
      watchers.length = 0;
      pending.clear();
    },
  };
}
