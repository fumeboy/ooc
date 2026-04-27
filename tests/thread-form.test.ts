/**
 * FormManager 测试
 *
 * @ref docs/superpowers/specs/2026-04-12-command-lifecycle-progressive-trait-design.md#6
 */
import { describe, test, expect } from "bun:test";
import { FormManager, type ActiveForm } from "../src/thread/form.js";

describe("FormManager", () => {
  test("begin 创建 form 并返回 form_id", () => {
    const mgr = new FormManager();
    const formId = mgr.begin("talk", "通知 sophia");
    expect(formId).toMatch(/^f_/);
    expect(mgr.activeForms()).toHaveLength(1);
    expect(mgr.activeForms()[0]!.command).toBe("talk");
    expect(mgr.activeForms()[0]!.description).toBe("通知 sophia");
  });

  test("submit 移除 form 并返回信息", () => {
    const mgr = new FormManager();
    const formId = mgr.begin("talk", "通知 sophia");
    const form = mgr.submit(formId);
    expect(form).not.toBeNull();
    expect(form!.formId).toBe(formId);
    expect(form!.command).toBe("talk");
    expect(mgr.activeForms()).toHaveLength(0);
  });

  test("submit 不存在的 form_id 返回 null", () => {
    const mgr = new FormManager();
    expect(mgr.submit("nonexistent")).toBeNull();
  });

  test("cancel 等同于 submit（移除 form）", () => {
    const mgr = new FormManager();
    const formId = mgr.begin("program", "读取文件");
    const form = mgr.cancel(formId);
    expect(form).not.toBeNull();
    expect(mgr.activeForms()).toHaveLength(0);
  });

  test("引用计数：同类型多个 form", () => {
    const mgr = new FormManager();
    const f1 = mgr.begin("talk", "通知 sophia");
    const f2 = mgr.begin("talk", "通知 kernel");
    expect(mgr.activeCommands()).toEqual(new Set(["talk"]));

    mgr.submit(f1);
    expect(mgr.activeCommands()).toEqual(new Set(["talk"])); // 还有 f2

    mgr.submit(f2);
    expect(mgr.activeCommands()).toEqual(new Set()); // 全部完成
  });

  test("不同类型 form 可并行", () => {
    const mgr = new FormManager();
    mgr.begin("talk", "通知");
    mgr.begin("program", "读文件");
    expect(mgr.activeCommands()).toEqual(new Set(["talk", "program"]));
  });

  test("toData / fromData 持久化", () => {
    const mgr = new FormManager();
    mgr.begin("talk", "通知 sophia");
    mgr.begin("program", "读文件");
    const data = mgr.toData();
    expect(data).toHaveLength(2);

    const restored = FormManager.fromData(data);
    expect(restored.activeForms()).toHaveLength(2);
    expect(restored.activeCommands()).toEqual(new Set(["talk", "program"]));
  });

  test("getForm 获取指定 form", () => {
    const mgr = new FormManager();
    const formId = mgr.begin("talk", "通知");
    expect(mgr.getForm(formId)).not.toBeNull();
    expect(mgr.getForm("nonexistent")).toBeNull();
  });
});

describe("FormManager — program trait/method extra fields", () => {
  test("begin 支持 trait 和 method 扩展字段", () => {
    const mgr = new FormManager();
    const formId = mgr.begin("program", "读取文件", {
      trait: "kernel/computable/file_ops",
      method: "readFile",
    });
    const form = mgr.getForm(formId);
    expect(form).not.toBeNull();
    expect(form!.trait).toBe("kernel/computable/file_ops");
    expect(form!.method).toBe("readFile");
  });

  test("begin 不传 extra 时扩展字段为 undefined", () => {
    const mgr = new FormManager();
    const formId = mgr.begin("talk", "通知");
    const form = mgr.getForm(formId);
    expect(form).not.toBeNull();
    expect(form!.trait).toBeUndefined();
    expect(form!.method).toBeUndefined();
  });

  test("toData/fromData 保留扩展字段", () => {
    const mgr = new FormManager();
    mgr.begin("program", "读取文件", {
      trait: "kernel/computable/file_ops",
      method: "readFile",
    });
    const data = mgr.toData();
    const restored = FormManager.fromData(data);
    const form = restored.activeForms()[0]!;
    expect(form.trait).toBe("kernel/computable/file_ops");
    expect(form.method).toBe("readFile");
  });
});
