/**
 * P0b — 上下文压缩最小闭环 e2e。
 *
 * Design: docs/2026-05-25-context-compression-design.md
 * 任务说明: AgentOfThinkable P0b
 *
 * 不走真 LLM:直接调 dispatchToolCall 模拟 LLM 行为,完整覆盖以下链路:
 * 1. 构造 thread + insert 一个真实 file_window
 * 2. dispatchToolCall(compress, scope="windows", target_ids=[file_window_id], level=1)
 *    - 断言 window.compressLevel === 1
 *    - 断言 thread.events 多了一条 context_compressed 事件
 *    - 断言 renderContextXml 输出 fallback 压缩节点 (<compressed level="1">) + commands hint=expand
 * 3. dispatchToolCall(exec, command="expand", window_id=file_window_id)
 *    - 断言 window.compressLevel === 0
 *    - 断言 thread.events 又多了一条 context_compressed 事件 (levelChange="1→0", reason="user-expand")
 *    - 断言 renderContextXml 恢复完整 file_window 渲染 (含 <path> + <content>)
 *
 * 不依赖 RUN_BACKEND_E2E gate:这是 fixture-based unit-style 验收,可在 bun test src/ 外
 * 直接跑。位置放在 tests/e2e/backend/ 以匹配任务要求。
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dispatchToolCall } from "@src/executable/tools";
import { makeThread } from "@src/__tests__/make-thread";
import { renderContextXml } from "@src/thinkable/context/render";
import { generateWindowId } from "@src/executable/windows/_shared/types";
import type { FileWindow } from "@src/executable/windows/_shared/types";

// 触发 windows/ 各 type 的 side-effect 注册(file_window 的 renderXml 需要这个)。
import "@src/executable/windows";

describe("[p0b] context compression — compress(scope=windows) + expand 最小闭环", () => {
  it("compress → 压缩态 + 落事件;expand → 恢复 live + 再落事件", async () => {
    // ── 1. 准备一个临时文件 + thread + file_window
    const tmpRoot = mkdtempSync(join(tmpdir(), "ooc-p0b-compress-"));
    const filePath = join(tmpRoot, "sample.txt");
    writeFileSync(
      filePath,
      "alpha\nbeta\ngamma\ndelta\nepsilon\n",
      "utf8",
    );

    try {
      const thread = makeThread();
      const fileWindowId = generateWindowId("file");
      const fileWindow: FileWindow = {
        id: fileWindowId,
        type: "file",
        title: "sample.txt",
        status: "open",
        createdAt: Date.now(),
        path: filePath,
      };
      thread.contextWindows.push(fileWindow);

      // 验证基线:compressLevel 未设
      expect(thread.contextWindows.find((w) => w.id === fileWindowId)?.compressLevel).toBeUndefined();

      // ── 2. 压缩到 level=1
      const compressOutput = await dispatchToolCall(thread, {
        id: "call_compress_1",
        name: "compress",
        arguments: {
          scope: "windows",
          target_ids: [fileWindowId],
          level: 1,
          title: "fold file window",
        },
      });
      const compressParsed = JSON.parse(compressOutput);
      expect(compressParsed.ok).toBe(true);
      expect(compressParsed.tool).toBe("compress");
      expect(compressParsed.changed).toEqual([fileWindowId]);
      expect(compressParsed.level).toBe(1);

      // 2a. 断言 window 状态切到 level=1
      const afterCompress = thread.contextWindows.find((w) => w.id === fileWindowId);
      expect(afterCompress).toBeDefined();
      expect(afterCompress!.compressLevel).toBe(1);

      // 2b. 断言事件流多了一条 context_compressed
      const compressEvents = thread.events.filter(
        (e) => e.category === "context_change" && e.kind === "context_compressed",
      );
      expect(compressEvents.length).toBe(1);
      const e1 = compressEvents[0];
      // narrow 类型守卫:让 TS 接受字段访问
      expect(e1.category).toBe("context_change");
      if (e1.category === "context_change" && e1.kind === "context_compressed") {
        expect(e1.windowIds).toEqual([fileWindowId]);
        expect(e1.levelChange).toBe("0→1");
        expect(e1.reason).toBe("user-compress");
        expect(e1.scope).toBe("windows");
      }

      // 2c. 断言渲染走 fallback 压缩态: 含 <compressed level="1"> + commands 含 expand,
      //     不含完整 <content> 节点
      const xmlCompressed = await renderContextXml({
        thread,
        contextWindows: thread.contextWindows,
      });
      expect(xmlCompressed).toContain(`id="${fileWindowId}"`);
      expect(xmlCompressed).toContain(`<compressed level="1"`);
      expect(xmlCompressed).toContain(`name="expand"`);
      // 完整渲染的 file_window 会有 <content> 节点;压缩态 fallback 不应输出
      // (file_window 的内容 "alpha..." 应当不在压缩态 XML 中可见)。
      // 用 sample.txt 第一行 "alpha" 作为完整内容的 sentinel
      const fileWindowSection = extractWindowSection(xmlCompressed, fileWindowId);
      expect(fileWindowSection).toBeTruthy();
      expect(fileWindowSection).not.toContain("alpha");

      // ── 3. expand 回 live
      const expandOutput = await dispatchToolCall(thread, {
        id: "call_expand_1",
        name: "exec",
        arguments: {
          window_id: fileWindowId,
          command: "expand",
          title: "expand file window",
        },
      });
      const expandParsed = JSON.parse(expandOutput);
      expect(expandParsed.ok).toBe(true);
      expect(expandParsed.tool).toBe("exec");
      expect(expandParsed.current_level).toBe(0);
      expect(expandParsed.previous_level).toBe(1);

      // 3a. 断言 window 切回 0
      const afterExpand = thread.contextWindows.find((w) => w.id === fileWindowId);
      expect(afterExpand!.compressLevel).toBe(0);

      // 3b. 断言又多了一条 context_compressed 事件 (levelChange "1→0", reason="user-expand")
      const compressEvents2 = thread.events.filter(
        (e) => e.category === "context_change" && e.kind === "context_compressed",
      );
      expect(compressEvents2.length).toBe(2);
      const e2 = compressEvents2[1];
      if (e2.category === "context_change" && e2.kind === "context_compressed") {
        expect(e2.windowIds).toEqual([fileWindowId]);
        expect(e2.levelChange).toBe("1→0");
        expect(e2.reason).toBe("user-expand");
      }

      // 3c. 断言渲染恢复完整内容: 应出现 <content> 与 sample.txt 中的 "alpha"
      const xmlLive = await renderContextXml({
        thread,
        contextWindows: thread.contextWindows,
      });
      const liveSection = extractWindowSection(xmlLive, fileWindowId);
      expect(liveSection).toBeTruthy();
      expect(liveSection).toContain("alpha");
      // 不再含 <compressed level="1"> 元节点
      expect(liveSection).not.toContain(`<compressed`);
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

/** 从完整 context XML 中切出指定 window 段(`<window id="<id>" ...>...</window>`)。 */
function extractWindowSection(xml: string, windowId: string): string | undefined {
  const startMarker = `<window id="${windowId}"`;
  const startIdx = xml.indexOf(startMarker);
  if (startIdx < 0) return undefined;
  // 找匹配的 </window>;此处 file_window 不会有 sub_windows 嵌套同 id 的情况,
  // 简单查找下一个 </window> 即可(测试上下文足够窄)。
  const endIdx = xml.indexOf("</window>", startIdx);
  if (endIdx < 0) return undefined;
  return xml.slice(startIdx, endIdx + "</window>".length);
}
