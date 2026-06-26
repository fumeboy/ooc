/**
 * renderReadable 3 档 fallback 测试 —— issue E。
 *
 * 三档：render-fn / static-card / placeholder。
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  ClassRegistry,
  ObjectInsRegistry,
  builtinClassRegistry,
  getSessionRegistry,
  releaseSessionRegistry,
} from "@ooc/core/runtime/object-registry";
import "@ooc/core/runtime/object-register.builtins";
import { renderReadable } from "@ooc/core/readable";
import { xmlElement, xmlText, serializeXml } from "@ooc/core/types/xml";
import type { OocClass } from "@ooc/core/runtime/ooc-class.js";

const SESSION = "test-render-readable";

describe("renderReadable 3-tier fallback (issue E)", () => {
  beforeEach(() => releaseSessionRegistry(SESSION));
  afterEach(() => releaseSessionRegistry(SESSION));

  it("tier 1: render-fn hit returns source=render-fn with projectionView", async () => {
    const reg = getSessionRegistry(SESSION);
    // pick a builtin with render fn: method_exec_form
    const ref = {
      id: "form-1",
      class: "_builtin/agent/method_exec_form",
      createdAt: Date.now(),
    };
    reg.setObject({
      id: ref.id,
      class: ref.class,
      data: {
        targetObjectId: "obj-1",
        guideName: "do",
        accumulatedArgs: {},
        createdAt: Date.now(),
      },
    });
    const result = await renderReadable(ref, reg, reg);
    expect(result.source).toBe("render-fn");
    expect(result.projectionView).toBe("default");
    expect(Array.isArray(result.payload)).toBe(true);
  });

  it("tier 2: static-card hit when loadStoneReadableMd returns text", async () => {
    // Build a small registry with a class that has NO readable render
    const noRenderClass: OocClass = {
      id: "_test/no-render",
      // no readable module
    };
    const reg = new ObjectInsRegistry();
    reg.register(noRenderClass);
    const ref = { id: "x", class: "_test/no-render", createdAt: Date.now() };
    const result = await renderReadable(ref, reg, reg, {
      loadStoneReadableMd: async (cls, id) => {
        expect(cls).toBe("_test/no-render");
        expect(id).toBe("x");
        return "# Card\n\nstatic card body";
      },
    });
    expect(result.source).toBe("static-card");
    expect(typeof result.payload).toBe("string");
    expect(result.payload).toContain("static card body");
  });

  it("tier 3: placeholder when no render and no card", async () => {
    const noRenderClass: OocClass = {
      id: "_test/no-render-no-card",
    };
    const reg = new ObjectInsRegistry();
    reg.register(noRenderClass);
    const ref = { id: "y", class: "_test/no-render-no-card", createdAt: Date.now() };
    const result = await renderReadable(ref, reg, reg);
    expect(result.source).toBe("placeholder");
    expect(result.warning).toBeDefined();
    // payload is XmlNode[] with the placeholder text
    const xmlStr = serializeXml(
      xmlElement("root", {}, Array.isArray(result.payload) ? result.payload : [xmlText(result.payload)]),
    );
    expect(xmlStr).toContain("no readable for class _test/no-render-no-card");
  });

  it("tier 3: placeholder when loadStoneReadableMd returns undefined or empty", async () => {
    const noRenderClass: OocClass = {
      id: "_test/empty-card",
    };
    const reg = new ObjectInsRegistry();
    reg.register(noRenderClass);
    const ref = { id: "z", class: "_test/empty-card", createdAt: Date.now() };
    const result = await renderReadable(ref, reg, reg, {
      loadStoneReadableMd: async () => "   ", // whitespace only
    });
    expect(result.source).toBe("placeholder");
  });
});
