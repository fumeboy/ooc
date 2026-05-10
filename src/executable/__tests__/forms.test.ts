import { describe, it, expect, beforeEach } from "bun:test";
import { FormManager } from "../forms/form";

describe("FormManager", () => {
  let formManager: FormManager;

  beforeEach(() => {
    formManager = new FormManager();
  });

  it("should create a form and return form_id", () => {
    const formId = formManager.open("talk", "test description");
    expect(typeof formId).toBe("string");
    expect(formId.length).toBeGreaterThan(0);
  });

  it("should retrieve an active form", () => {
    const formId = formManager.open("talk", "test description");
    const form = formManager.getForm(formId);
    expect(form).not.toBeNull();
    expect(form?.command).toBe("talk");
    expect(form?.description).toBe("test description");
    expect(form?.accumulatedArgs).toEqual({});
  });

  it("should apply refine to accumulate args", () => {
    const formId = formManager.open("talk", "test description");
    const updatedForm = formManager.refine(formId, { target: "user", message: "hello" });
    
    expect(updatedForm).not.toBeNull();
    expect(updatedForm?.accumulatedArgs).toEqual({ target: "user", message: "hello" });
    
    const retrieved = formManager.getForm(formId);
    expect(retrieved?.accumulatedArgs).toEqual({ target: "user", message: "hello" });
  });

  it("should override existing args on refine", () => {
    const formId = formManager.open("talk", "test description");
    formManager.refine(formId, { target: "user", message: "hello" });
    formManager.refine(formId, { message: "updated" });
    
    const form = formManager.getForm(formId);
    expect(form?.accumulatedArgs).toEqual({ target: "user", message: "updated" });
  });

  it("should submit a form and remove it from active forms", () => {
    const formId = formManager.open("talk", "test description");
    const submitted = formManager.submit(formId);
    
    expect(submitted).not.toBeNull();
    expect(submitted?.formId).toBe(formId);
    
    const afterSubmit = formManager.getForm(formId);
    expect(afterSubmit).toBeNull();
  });

  it("should close a form same as submit", () => {
    const formId = formManager.open("talk", "test description");
    const closed = formManager.close(formId);

    expect(closed).not.toBeNull();
    expect(closed?.formId).toBe(formId);

    const afterClose = formManager.getForm(formId);
    expect(afterClose).toBeNull();
  });

  it("should track active commands", () => {
    formManager.open("talk", "talk 1");
    formManager.open("program", "program 1");
    formManager.open("talk", "talk 2");
    
    const active = formManager.activeCommands();
    expect(active.size).toBe(2);
    expect(active.has("talk")).toBe(true);
    expect(active.has("program")).toBe(true);
  });

  it("should merge active command paths", () => {
    formManager.open("talk", "talk 1");
    
    const paths = formManager.activeCommandPaths();
    expect(paths.size).toBeGreaterThan(0);
    expect(paths.has("talk")).toBe(true);
  });

  it("should list all active forms", () => {
    formManager.open("talk", "talk 1");
    formManager.open("program", "program 1");
    
    const forms = formManager.activeForms();
    expect(forms).toHaveLength(2);
    expect(forms.some(f => f.command === "talk")).toBe(true);
    expect(forms.some(f => f.command === "program")).toBe(true);
  });

  it("should add loaded knowledge paths to a form", () => {
    const formId = formManager.open("talk", "test description");
    formManager.addLoadedKnowledgePaths(formId, ["knowledge:talk/base", "knowledge:talk/wait"]);
    formManager.addLoadedKnowledgePaths(formId, ["knowledge:talk/wait", "knowledge:talk/continue"]);
    
    const form = formManager.getForm(formId);
    expect(form?.loadedKnowledgePaths).toEqual([
      "knowledge:talk/base",
      "knowledge:talk/wait",
      "knowledge:talk/continue",
    ]);
  });

  it("should support fromData and toData for persistence", () => {
    const formId = formManager.open("talk", "test description");
    formManager.refine(formId, { target: "user" });
    
    const data = formManager.toData();
    expect(data).toHaveLength(1);
    
    const newManager = FormManager.fromData(data);
    const retrieved = newManager.getForm(formId);
    
    expect(retrieved).not.toBeNull();
    expect(retrieved?.command).toBe("talk");
    expect(retrieved?.accumulatedArgs).toEqual({ target: "user" });
  });

  it("should drop deprecated trait and method fields when restoring legacy data", () => {
    const restored = FormManager.fromData([
      {
        formId: "f_legacy",
        command: "program",
        description: "legacy program form",
        createdAt: 1,
        accumulatedArgs: { function: "readFile" },
        commandPath: "program.function",
        trait: "filesystem",
        method: "readFile",
        loadedTraits: ["knowledge:program/function"]
      } as unknown as never
    ]).getForm("f_legacy") as unknown as {
      trait?: unknown;
      method?: unknown;
      loadedTraits?: unknown;
      loadedKnowledgePaths?: string[];
    };

    expect(restored).not.toBeNull();
    expect("trait" in restored).toBe(false);
    expect("method" in restored).toBe(false);
    expect("loadedTraits" in restored).toBe(false);
    expect(restored.loadedKnowledgePaths).toEqual(["knowledge:program/function"]);
  });
});
