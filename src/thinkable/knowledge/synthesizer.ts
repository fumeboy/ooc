/**
 * Knowledge synthesizer — 把 thread.contextWindows 与 protocol / activator /
 * type-level basic 来源的 KnowledgeWindow 合成在一起，返回给渲染层 / 前端。
 *
 * 数据流（每轮 LLM tick 触发一次）：
 *   buildInputItems → collectExecutableKnowledgeEntries → renderContextXml
 *
 * 合成来源：
 * - protocol：全局 KNOWLEDGE 常量；root 命令清单；reflectable（sessionId="super" 门控）；
 *   每个 command_exec form 的 knowledge() 派生条目；按 type 注入的 basicKnowledge
 * - activator：stones/{id}/knowledge/*.md 经 commandPaths 命中（full / summary）
 *
 * 注意：
 * - 不 mutate 原 thread；synthetic windows 仅出现在返回的 contextWindows 副本中，
 *   不会落到 thread.json 持久化字段
 * - command_exec form 的 commandKnowledgePaths 仍会回写（保留 LLM 看到 form 时的协议提示链路）
 * - explicit knowledge_window（用户 open_knowledge）已经在 thread.contextWindows 中，原样保留；
 *   activator 命中同一 path 时跳过（避免重复）
 *
 * 历史：本模块 2026-05-18 前位于 src/executable/index.ts，作为执行子系统的内部
 * 实现。决定 LLM 看见什么知识本质上是 thinkable 概念（即便底层依赖 executable
 * 内部的 commands / windows registry），故归位到 thinkable/knowledge。
 */

import { deriveStoneFromThread, derivePoolFromThread, listBranchSkills, listObjectSkills, listExternalSkills, readWorldConfig } from "../../persistable/index.js";
import type { ThreadContext } from "../context.js";
import { BASIC_KNOWLEDGE_PATH, KNOWLEDGE } from "./basic-knowledge.js";
import { ROOT_BASIC_PATH, ROOT_METHODS, ROOT_KNOWLEDGE } from "../../executable/windows/root/index.js";
import {
  END_REFLECTION_REMINDER_KNOWLEDGE,
  END_REFLECTION_REMINDER_PATH,
  REFLECTABLE_BASIC_PATH,
  REFLECTABLE_KNOWLEDGE,
  REFLECTABLE_METAPROG_KNOWLEDGE,
  REFLECTABLE_METAPROG_PATH,
} from "../reflectable/reflectable-knowledge.js";
import { SUPER_SESSION_ID } from "../../executable/windows/_shared/super-constants.js";
import type { MethodKnowledgeEntries, MethodEntry } from "../../executable/windows/_shared/method-types.js";
import { getWindowTypeDefinition } from "../../executable/windows/_shared/registry.js";
import { resolveBasicKnowledge, resolveMethod } from "../../executable/windows/_shared/behavior.js";
import type { CommandExecWindow, ContextWindow, KnowledgeWindow, SkillIndexWindow } from "../../executable/windows/_shared/types.js";
import { ROOT_WINDOW_ID, SKILL_INDEX_WINDOW_ID } from "../../executable/windows/_shared/types.js";
import { computeActivations } from "./activator.js";
import { loadKnowledgeIndex } from "./loader.js";

const KNOWLEDGE_BODY_BYTES = 8192;

function samePaths(left: string[] | undefined, right: string[]): boolean {
  if (!left && right.length === 0) return true;
  if (!left || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

/**
 * 计算单个 command_exec form 关联的 knowledge entries。
 *
 * form 可能挂在任意 window 类型下（root / do_window / talk_window / ...），
 * 查找 entry 需按 parentWindowId 找到父 window 的 commands map，而非只看 ROOT_METHODS。
 */
export async function computeFormKnowledgeEntries(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<MethodKnowledgeEntries> {
  const entry = await lookupFormEntry(form, thread);
  const knowledgeEntries = entry?.knowledge
    ? { ...entry.knowledge(form.accumulatedArgs, form.status) }
    : {};

  return Object.fromEntries(
    Object.entries(knowledgeEntries).filter(([, content]) => typeof content === "string" && content.trim() !== ""),
  );
}

async function lookupFormEntry(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<MethodEntry | undefined> {
  const parentId = form.parentWindowId;
  if (!parentId || parentId === "root") {
    // root 在 base 链上无 executable（resolveMethod("root") → undefined），直接走 ROOT_METHODS。
    return (await resolveMethod("root", form.command)) ?? ROOT_METHODS[form.command];
  }
  const parent = (thread.contextWindows ?? []).find((w) => w.id === parentId);
  if (!parent) return undefined;
  // OOC-4 L4.2（C2）：parent 的 method 优先沿 base 原型链解析；链未提供时回退 registry。
  // trim 后 program/search/file/knowledge 的 method 已迁链，若此处不接链则 form 的
  // method-knowledge（EXEC_KNOWLEDGE / OPEN_MATCH_KNOWLEDGE / EDIT_KNOWLEDGE 等）静默丢失。
  const fromChain = await resolveMethod(parent.type, form.command);
  if (fromChain) return fromChain;
  return getWindowTypeDefinition(parent.type).methods[form.command];
}

/**
 * 把当前 form 的 commandKnowledgePaths 字段同步为最新派生 keys。
 * 返回新对象；keys 没变时返回原对象（避免无效 mutation）。
 */
export async function enrichFormCommandKnowledge(
  form: CommandExecWindow,
  thread: ThreadContext,
): Promise<CommandExecWindow> {
  const knowledgeEntries = await computeFormKnowledgeEntries(form, thread);
  const commandKnowledgePaths = Object.keys(knowledgeEntries);
  if (samePaths(form.commandKnowledgePaths, commandKnowledgePaths)) {
    return form;
  }
  return { ...form, commandKnowledgePaths };
}

/** 把 thread.contextWindows 与一组合成的 KnowledgeWindow 一起返回。 */
export async function collectExecutableKnowledgeEntries(
  contextWindows: ContextWindow[] | undefined,
  thread: ThreadContext,
): Promise<{ contextWindows: ContextWindow[] | undefined; knowledgeEntries: MethodKnowledgeEntries }> {
  // 1) protocol entries —— 全局 KNOWLEDGE + root 命令清单
  const protocolEntries: MethodKnowledgeEntries = {
    [BASIC_KNOWLEDGE_PATH]: KNOWLEDGE,
    [ROOT_BASIC_PATH]: ROOT_KNOWLEDGE,
  };

  // spec 2026-05-18 super-flow-channel：sessionId="super" 是反思场景门控
  if (thread.persistence?.sessionId === SUPER_SESSION_ID) {
    protocolEntries[REFLECTABLE_BASIC_PATH] = REFLECTABLE_KNOWLEDGE;
    // U7: 元编程协议指引——只在 super 注入；教 LLM 何时走 worktree 沙箱
    protocolEntries[REFLECTABLE_METAPROG_PATH] = REFLECTABLE_METAPROG_KNOWLEDGE;
  }

  const list = contextWindows ?? [];
  const enriched: ContextWindow[] = [];
  for (const window of list) {
    if (window.type !== "command_exec") {
      enriched.push(window);
      continue;
    }
    // sharing 状态的 command_exec form 不参与 knowledge 派生（plan §do_window.move）：
    // ref 看 snapshot；lent_out 已离手；都不应触发活动 knowledge 激活
    if (window.sharing) {
      enriched.push(window);
      continue;
    }
    const enrichedForm = await enrichFormCommandKnowledge(window, thread);
    enriched.push(enrichedForm);

    const entries = await computeFormKnowledgeEntries(enrichedForm, thread);
    for (const [path, content] of Object.entries(entries)) {
      if (!(path in protocolEntries)) {
        protocolEntries[path] = content;
      }
    }

    // G2 (Round 11): end-form reflection reminder —— 业务 thread 内开了 end form
    // 时，自动激活一段 hint knowledge，提醒 LLM 在 submit 前考虑是否需要走 super
    // flow 反思沉淀。
    //
    // 注入条件：
    // - form.command === "end"
    // - thread.persistence?.sessionId !== SUPER_SESSION_ID（super flow 内不套娃）
    //
    // 注入位置：protocolEntries（与 REFLECTABLE_KNOWLEDGE 同档；不是 form-scoped）
    // 设计原则：非阻塞 hint，LLM 自由判断；与 command.end.ts 的 KNOWLEDGE 描述独立。
    try {
      const isEndForm = enrichedForm.command === "end";
      const inSuperSession = thread.persistence?.sessionId === SUPER_SESSION_ID;
      if (isEndForm && !inSuperSession && !(END_REFLECTION_REMINDER_PATH in protocolEntries)) {
        protocolEntries[END_REFLECTION_REMINDER_PATH] = END_REFLECTION_REMINDER_KNOWLEDGE;
      }
    } catch (err) {
      // silent-swallow ban：注入失败不抛，warn 后继续
      console.warn(`[synthesizer] end-reflection-reminder inject failed: ${(err as Error).message}`);
    }
  }

  // 1.5) 按 thread.contextWindows 出现的 type 注入 type-level basicKnowledge——
  //      让 LLM 在没有 open 任何 command_exec 的情况下也能知道每种 window 上有哪些 method。
  //      防止"看到 talk_window 但只会试 root 上的 talk method"的常见误用。
  //      注：skill_index 在 §1.6 派生后再补一次（顺序原因）。
  const presentTypes = new Set<string>();
  for (const w of list) presentTypes.add(w.type);
  for (const t of presentTypes) {
    let def;
    try {
      def = getWindowTypeDefinition(t as ContextWindow["type"]);
    } catch {
      continue;
    }
    // OOC-4 L4.1：basicKnowledge 优先沿 base 原型链解析，链未提供时回退 registry（plan D2 / Task 4）。
    // 非 base / 骨架 type 链 miss → 回退 registry.basicKnowledge（harmless 且 forward-correct）。
    const basicKnowledge = (await resolveBasicKnowledge(t)) ?? def.basicKnowledge;
    if (!basicKnowledge) continue;
    const path = `internal/windows/${t}/basic`;
    if (!(path in protocolEntries)) {
      protocolEntries[path] = basicKnowledge;
    }
  }

  // 1.5.1) 🔥 子→父 reply 协议（root cause #1 / collaborable.creator_window）：
  //        若当前 thread 的 contextWindows 含 isCreatorWindow=true 的 do/talk window，
  //        注入一段**显式 reply 协议** knowledge——告诉子 thread LLM 唯一合法的回报
  //        通道是在 creator window 上调 continue / say，而不是 hallucinate end({result}).
  //        没有这段提示，LLM 会反复 silently 把结果塞进 end({result})，父侧永远收不到。
  //        path 派生稳定（含 window_id），同 path 不重复注入。
  for (const w of list) {
    const isCreator = (w.type === "do" || w.type === "talk") && w.isCreatorWindow === true;
    if (!isCreator) continue;
    const path = `internal/windows/${w.type}/creator-reply/${w.id}`;
    if (path in protocolEntries) continue;
    protocolEntries[path] = buildCreatorReplyKnowledge(w);
  }

  // 1.6) skill_index 派生（plan §skills 支持 / D2 + D6 + 用户补充）：
  //      扫描 stones/<branch>/skills 与 stones/<branch>/objects/<self>/skills，合并去重；
  //      2026-05-25 加入：若 .world.json 配置了 externalSkillsDir，也扫该目录（scope=external）。
  //      非空时注入一个 SkillIndexWindow 到 enriched contextWindows；空时不注入；
  //      thread.persistence 缺省（user/super 等场景）→ 没法定位 stoneRef，跳过。
  if (thread.persistence) {
    try {
      const stoneRef = deriveStoneFromThread(thread.persistence);
      const worldConfig = await readWorldConfig(thread.persistence.baseDir);
      const externalDir = worldConfig.externalSkillsDir;
      const [branchSkills, objectSkills, externalSkills] = await Promise.all([
        listBranchSkills(thread.persistence.baseDir, thread.persistence.stonesBranch),
        listObjectSkills(stoneRef),
        externalDir ? listExternalSkills(externalDir) : Promise.resolve([]),
      ]);
      // 同名优先级（特异性递增）：external < branch < object。
      // object 私有 skill 覆盖 branch 公共，branch 公共覆盖 external 系统级。
      const byName = new Map<string, typeof branchSkills[number]>();
      for (const s of externalSkills) byName.set(s.name, s);
      for (const s of branchSkills) byName.set(s.name, s);
      for (const s of objectSkills) byName.set(s.name, s);
      const merged = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
      if (merged.length > 0) {
        const skillIndex: SkillIndexWindow = {
          id: SKILL_INDEX_WINDOW_ID,
          type: "skill_index",
          parentWindowId: ROOT_WINDOW_ID,
          title: `Skills (${merged.length})`,
          status: "active",
          createdAt: Date.now(),
          skills: merged,
        };
        // 防重：如果已有同 id（理论上不会有，因为 thread.json 不持久化），覆盖
        const existing = enriched.findIndex((w) => w.id === SKILL_INDEX_WINDOW_ID);
        if (existing >= 0) enriched[existing] = skillIndex;
        else enriched.push(skillIndex);
        // 派生后补一次 type-level basicKnowledge（§1.5 是基于原 list 计算的，不含 skill_index）。
        // OOC-4 L4.1：skill_index 的 basicKnowledge 已从 registry 移到 base 原型链，
        // 优先 resolveBasicKnowledge 拿 base 版，registry 兜底（plan D2 / Task 4 :241）。
        const skillIndexBasicPath = "internal/windows/skill_index/basic";
        if (!(skillIndexBasicPath in protocolEntries)) {
          try {
            const basicKnowledge =
              (await resolveBasicKnowledge("skill_index")) ??
              getWindowTypeDefinition("skill_index").basicKnowledge;
            if (basicKnowledge) protocolEntries[skillIndexBasicPath] = basicKnowledge;
          } catch { /* skip */ }
        }
      }
    } catch {
      // skills 扫描失败不应阻断 LLM 渲染；静默跳过
    }
  }

  // 2) protocol entries → KnowledgeWindow（source=protocol）
  const synthetic: ContextWindow[] = [];
  for (const [path, body] of Object.entries(protocolEntries)) {
    synthetic.push(makeKnowledgeWindow(path, body, "protocol"));
  }

  // 3) activator 命中 → KnowledgeWindow（source=activator + presentation）
  const explicitPaths = new Set(
    enriched.filter((w): w is KnowledgeWindow => w.type === "knowledge" && w.source === "explicit").map((w) => w.path),
  );
  if (thread.persistence) {
    try {
      // 2026-05-24: 双源扫描——stone seed（设计层，进 git）+ pool sediment（运行时）。
      // LLM 看到的不分来源；同名冲突 sediment 胜出（详见 loader.ts loadKnowledgeIndex）。
      const stoneRef = deriveStoneFromThread(thread.persistence);
      const poolRef = derivePoolFromThread(thread.persistence);
      const index = await loadKnowledgeIndex({ stone: stoneRef, pool: poolRef });
      const activations = computeActivations(thread, index);
      for (const act of activations) {
        // explicit 优先；activator 重复命中同一 path 时跳过
        if (explicitPaths.has(act.path)) continue;
        const body = act.presentation === "full" ? truncateKnowledgeBody(act.doc.body) : "";
        synthetic.push({
          ...makeKnowledgeWindow(act.path, body, "activator"),
          presentation: act.presentation,
          description: act.doc.frontmatter.description,
        });
      }
    } catch {
      // 加载失败时静默：与 render 层 computeActiveKnowledgeNode 旧行为保持一致
    }
  }

  // 4) relations 不再以 RelationWindow 派生（OOC-4 L6a 已删 relation_window）；
  //    self 对身边 peer（siblings/children ∪ talk peers）的关系认知改由自视切片
  //    `<self_view><relations>` 每轮注入，见 src/thinkable/context/self-view.ts:renderRelationsSlice。

  // 5) 返回时把 synthetic windows 附加到 enriched 的副本上
  const finalWindows = synthetic.length > 0 ? [...enriched, ...synthetic] : enriched;

  return { contextWindows: finalWindows, knowledgeEntries: protocolEntries };
}

/** 与 render 层共用的 8KB 截断；本地实现避免反向 import render.ts。 */
function truncateKnowledgeBody(body: string): string {
  const bytes = new TextEncoder().encode(body);
  if (bytes.length <= KNOWLEDGE_BODY_BYTES) return body;
  const head = new TextDecoder().decode(bytes.slice(0, KNOWLEDGE_BODY_BYTES));
  return `${head}...[truncated, original ${bytes.length} bytes]`;
}

let syntheticIdCounter = 0;
function nextSyntheticId(): string {
  syntheticIdCounter += 1;
  return `kn_${Date.now().toString(36)}_${syntheticIdCounter.toString(36)}`;
}

/**
 * 子→父 reply 协议（root cause #1）：构造一段 per-window 的 protocol knowledge，
 * 显式告诉子 thread LLM "你的 creator window id 是 X；想回报结果调它的
 * continue/say，end method 不是回报通道"。
 *
 * 为什么不放在 type-level basicKnowledge：
 * - 同一 type 的 creator vs 非 creator 视角不同；type-level 没法分视角。
 * - 不引入新抽象：仍然是 KnowledgeWindow + protocol source，只是 path 含 window_id。
 *
 * 内容贴合 collaborable.creator_window 段（meta/object.doc.ts:952-968）。
 */
function buildCreatorReplyKnowledge(window: ContextWindow): string {
  if (window.type === "do") {
    return [
      "# 子→父 reply 协议（你的 creator do_window）",
      "",
      `你当前 thread 的 creator window 是 \`${window.id}\`（type=do_window，isCreatorWindow=true，不可被 close）。`,
      "",
      "**想把结果 / 状态 / 中间进展带回父线程，唯一通道**：",
      "",
      "```",
      `exec(window_id="${window.id}", method="continue", args={ msg: "<结果或状态描述>" })`,
      "```",
      "",
      "这条消息会被自动 deliver 到父 thread 的 inbox，父 LLM 下一轮就能看到。",
      "",
      "**重要边界**：",
      "- `end` method 只用于声明本轮**自己**结束，**不是回报通道**。",
      "- 即便 end 接受 `result` 参数（便捷糖），它内部仍是模拟在 creator window 上调一次 continue；",
      "  多段对话 / 复杂状态汇报，请显式走 `creator_do_window.continue`，不要塞到 end 里。",
      "- 不要 hallucinate \"reply\" / \"report\" / \"finish_with\" 等不存在的 method；只有 continue / wait / close。",
    ].join("\n");
  }
  // talk creator window —— OOC-4 L5c：回信经 root.talk(target=<caller objectId>)，不再用 talk_window.say。
  const caller = (window as { target?: string }).target ?? "<caller objectId>";
  return [
    "# 跨对象回信协议（你是某个 caller 创建的 callee）",
    "",
    `创建你的 caller object 是 \`${caller}\`。你与它的会话历史出现在 <self_view><talks> 自视切片（peer="${caller}"）。`,
    "",
    "**想给 caller 回信，唯一通道**（window-free，直接用 root.talk 按 caller objectId 路由）：",
    "",
    "```",
    `exec(method="talk", args={ target: "${caller}", content: "<回复内容>", wait: false|true })`,
    "```",
    "",
    "这条消息会通过 deliverMessage 派送回 caller object 的对端 thread；caller 下一轮就能看到。",
    "",
    "**重要边界**：",
    "- `end` method 只用于声明本轮**自己**结束，**不是回报通道**。",
    `- 即便 end 接受 \`result\` 参数（便捷糖），它内部仍是模拟向 caller \`${caller}\` 回一条 talk；`,
    `  多轮往返 / 复杂确认，请显式走 \`talk(target="${caller}", ...)\`，不要塞到 end 里。`,
    "- 不需要创建任何 talk_window；同一 caller 的会话用同一 target 自动延续。",
  ].join("\n");
}

function makeKnowledgeWindow(
  path: string,
  body: string,
  source: NonNullable<KnowledgeWindow["source"]>,
): KnowledgeWindow {
  return {
    id: nextSyntheticId(),
    type: "knowledge",
    parentWindowId: "root",
    title: path,
    status: "open",
    createdAt: Date.now(),
    path,
    source,
    body,
  };
}

