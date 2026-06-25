/**
 * feishu_app smoke test —— 验证 stub 路径（无 FEISHU_APP_ID 时）+ 配置探测。
 *
 * 不验证真实 lark API 调用（需要真 secret）；只测路径分流逻辑。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import "@ooc/core/runtime/object-register.builtins";
import { getSessionRegistry, releaseSessionRegistry } from "@ooc/core/runtime/object-registry";
import { isLarkConfigured } from "@ooc/builtins/feishu_app/lark-client";

const SID = "feishu-test";

describe("feishu_app stub", () => {
  beforeEach(() => releaseSessionRegistry(SID));
  afterEach(() => releaseSessionRegistry(SID));

  it("isLarkConfigured reads env", () => {
    // Save + clear env
    const origId = process.env.FEISHU_APP_ID;
    const origSec = process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    expect(isLarkConfigured()).toBe(false);
    process.env.FEISHU_APP_ID = "test-app";
    process.env.FEISHU_APP_SECRET = "test-secret";
    expect(isLarkConfigured()).toBe(true);
    // Restore
    if (origId) process.env.FEISHU_APP_ID = origId;
    else delete process.env.FEISHU_APP_ID;
    if (origSec) process.env.FEISHU_APP_SECRET = origSec;
    else delete process.env.FEISHU_APP_SECRET;
  });

  it("send_message falls back to stub when not configured", async () => {
    const origId = process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_ID;
    const reg = getSessionRegistry(SID);
    const ctor = reg.resolveConstructor("_builtin/feishu_app")!;
    const data = await ctor.exec(
      { sessionId: SID, worldDir: "", dir: "", args: {} },
      {},
    );
    reg.setObject({ id: "_builtin/feishu_app", class: "_builtin/feishu_app", data });
    const method = reg.resolveObjectMethod("_builtin/feishu_app", "send_message")!;
    const { makeSelfProxy } = await import("@ooc/core/runtime/self-proxy");
    const self = makeSelfProxy(data as object, "_builtin/feishu_app", undefined);
    const result = await method.exec(
      {
        object: { id: "_builtin/feishu_app", class: "_builtin/feishu_app" },
        runtime: { instantiate: async () => ({ id: "x", class: "x", createdAt: 0 }) },
        reportDataEdit: async () => {},
        args: {},
        dir: "",
        worldDir: "",
        sessionId: SID,
      },
      self,
      { chat_id: "chat-1", content: "hello" },
    );
    const normalized = typeof result === "string" ? { message: result } : result ?? {};
    expect(normalized.message).toContain("stub");
    if (origId) process.env.FEISHU_APP_ID = origId;
  });
});
