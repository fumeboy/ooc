import { describe, it, expect, beforeEach } from "bun:test";
import { FormManager, type ActiveForm } from "../forms/form";

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
    expect(form?.commandKnowledgePaths).toEqual([]);
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

  it("should keep submitted form in active set as executing", () => {
    const formId = formManager.open("talk", "test description");
    const submitted = formManager.submit(formId);

    expect(submitted).not.toBeNull();
    expect(submitted?.formId).toBe(formId);
    expect(submitted?.status).toBe("executing");

    const stillThere = formManager.getForm(formId);
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("executing");
  });

  it("should close a form regardless of status", () => {
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
      commandKnowledgePaths?: string[];
    };

    expect(restored).not.toBeNull();
    expect("trait" in restored).toBe(false);
    expect("method" in restored).toBe(false);
    expect("loadedTraits" in restored).toBe(false);
    expect(restored.loadedKnowledgePaths).toEqual(["knowledge:program/function"]);
    expect(restored.commandKnowledgePaths).toEqual([]);
  });

  it("should default new form status to open", () => {
    const formId = formManager.open("talk", "test description");
    const form = formManager.getForm(formId);
    expect(form?.status).toBe("open");
    expect(form?.result).toBeUndefined();
  });

  it("should transition status from open to executing to executed", () => {
    const formId = formManager.open("program", "shell");
    expect(formManager.getForm(formId)?.status).toBe("open");

    const submitted = formManager.submit(formId);
    expect(submitted?.status).toBe("executing");
    expect(formManager.getForm(formId)?.status).toBe("executing");

    const executed = formManager.markExecuted(formId, "[stdout]\nhi\n[exit 0]");
    expect(executed?.status).toBe("executed");
    expect(executed?.result).toBe("[stdout]\nhi\n[exit 0]");
    expect(formManager.getForm(formId)?.status).toBe("executed");
    expect(formManager.getForm(formId)?.result).toBe("[stdout]\nhi\n[exit 0]");
  });

  it("should reject refine on non-open form", () => {
    const formId = formManager.open("program", "shell");
    formManager.submit(formId);
    const refined = formManager.refine(formId, { code: "ls" });
    expect(refined).toBeNull();
  });

  it("should reject submit on non-open form", () => {
    const formId = formManager.open("program", "shell");
    formManager.submit(formId);
    const second = formManager.submit(formId);
    expect(second).toBeNull();
  });

  it("should default missing status to open when restoring legacy data", () => {
    const restored = FormManager.fromData([
      {
        formId: "f_legacy",
        command: "talk",
        description: "no status field",
        createdAt: 1,
        accumulatedArgs: {},
        commandPaths: ["talk"],
        loadedKnowledgePaths: []
      } as unknown as ActiveForm
    ]).getForm("f_legacy");
    expect(restored?.status).toBe("open");
  });
});
