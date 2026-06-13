/**
 * extendable — 第三方 / 外部世界 集成的扩展层。
 *
 * 与 OOC 核心 8 维度（thinkable / executable / collaborable / observable / reflectable
 * / programmable / visible / persistable）平行：核心维度回答"OOC Agent 自身能干什么"，
 * extendable 回答"OOC 如何吃下外部世界（外部 SaaS / CLI / SDK）"。
 *
 * 当前子目录：
 * - builtins/ 内置 OOC Objects（原 builtin windows）
 * - lark/    飞书 (Lark Suite) 集成；通过 lark-cli 子进程 + ContextWindow 类型注册
 *
 * 添加新外部集成时：
 * 1. 在本目录下建子目录（如 \`extendable/notion/\`）
 * 2. 子目录的 index.ts 做 side-effect 注册（registerExecutable / 注册 root opener / 等）
 * 3. 在本文件追加 \`import "./<sub>/index.js";\`
 *
 * 这条 barrel 由 src/executable/windows/index.ts 在所有 builtin window type 加载完成后拉起，
 * 保证扩展类型在通用层 boot 校验（assertAllObjectDefinitionsRegistered）之前注册到位。
 */

import "@ooc/builtins/knowledge";
import "@ooc/builtins/file";
import "@ooc/builtins/todo";
import "@ooc/builtins/search";
import "@ooc/builtins/skill_index";
import "@ooc/builtins/plan";
import "@ooc/builtins/program";
import "@ooc/builtins/filesystem";
import "@ooc/builtins/terminal";
import "@ooc/builtins/world";
import "@ooc/builtins/knowledge_base";
import "@ooc/builtins/root";
import "./lark/index.js";
