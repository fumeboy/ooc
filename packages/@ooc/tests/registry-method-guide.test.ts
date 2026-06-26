/**
 * registry method/guide cohesion test —— 验证 issue 2026-06-26-object-guide-method-split 引入的
 * 注册期 fail-loud 校验：
 *
 *   1. methods / guides / window_methods 三侧 name 全集不重名（含跨域）
 *   2. window decl 的 object_methods 引用悬空 → fail
 *   3. window decl 的 guide_methods 引用悬空 → fail
 *   4. guides 内部按 name 自查重 → fail
 */
import { describe, it, expect } from "bun:test";
import { ClassRegistry } from "@ooc/core/runtime/object-registry";
import type { OocClass } from "@ooc/core/runtime/ooc-class";
import type {
  ObjectGuideMethod,
  ObjectMethod,
  ObjectMethodIntents,
} from "@ooc/core/types/index";

function makeMethod(name: string): ObjectMethod {
  return {
    name,
    description: `m:${name}`,
    exec: () => ({}),
  };
}

function makeGuide(name: string): ObjectGuideMethod {
  return {
    name,
    description: `g:${name}`,
    intents: [{ name: `intent:${name}`, description: "" }],
    route: (): ObjectMethodIntents => ({}),
    exec: () => ({}),
  };
}

describe("ClassRegistry method/guide cohesion", () => {
  it("rejects same name on method + guide", () => {
    const reg = new ClassRegistry();
    const cls: OocClass = {
      id: "test/dup-method-guide",
      executable: {
        methods: [makeMethod("foo")],
        guides: [makeGuide("foo")],
      },
    };
    expect(() => reg.register(cls)).toThrow(
      /both object method and guide method/i,
    );
  });

  it("rejects same name on guide + window_method", () => {
    const reg = new ClassRegistry();
    const cls: OocClass = {
      id: "test/dup-guide-win",
      executable: {
        methods: [],
        guides: [makeGuide("foo")],
      },
      readable: {
        readable: () => ({ class: "x", content: "" }),
        window: [
          {
            class: "x",
            object_methods: [],
            guide_methods: ["foo"],
            window_methods: [
              { name: "foo", description: "", exec: (_c, _s, w) => w },
            ],
          },
        ],
      },
    };
    expect(() => reg.register(cls)).toThrow(
      /both guide method and window method/i,
    );
  });

  it("rejects duplicate guide name within guides", () => {
    const reg = new ClassRegistry();
    const cls: OocClass = {
      id: "test/dup-guide",
      executable: {
        methods: [],
        guides: [makeGuide("foo"), makeGuide("foo")],
      },
    };
    expect(() => reg.register(cls)).toThrow(/Duplicate guide method name "foo"/);
  });

  it("rejects window decl referencing unknown object_method", () => {
    const reg = new ClassRegistry();
    const cls: OocClass = {
      id: "test/dangling-method-ref",
      executable: {
        methods: [makeMethod("present")],
      },
      readable: {
        readable: () => ({ class: "x", content: "" }),
        window: [
          {
            class: "x",
            object_methods: ["missing"],
            window_methods: [],
          },
        ],
      },
    };
    expect(() => reg.register(cls)).toThrow(/unknown object method "missing"/);
  });

  it("rejects window decl referencing unknown guide_method", () => {
    const reg = new ClassRegistry();
    const cls: OocClass = {
      id: "test/dangling-guide-ref",
      executable: {
        methods: [],
        guides: [makeGuide("present")],
      },
      readable: {
        readable: () => ({ class: "x", content: "" }),
        window: [
          {
            class: "x",
            object_methods: [],
            guide_methods: ["missing"],
            window_methods: [],
          },
        ],
      },
    };
    expect(() => reg.register(cls)).toThrow(/unknown guide method "missing"/);
  });

  it("accepts class with method + guide + window referenced correctly", () => {
    const reg = new ClassRegistry();
    const cls: OocClass = {
      id: "test/cohesion-ok",
      executable: {
        methods: [makeMethod("m1")],
        guides: [makeGuide("g1")],
      },
      readable: {
        readable: () => ({ class: "x", content: "" }),
        window: [
          {
            class: "x",
            object_methods: ["m1"],
            guide_methods: ["g1"],
            window_methods: [
              { name: "w1", description: "", exec: (_c, _s, w) => w },
            ],
          },
        ],
      },
    };
    expect(() => reg.register(cls)).not.toThrow();
    expect(reg.resolveObjectGuideMethod("test/cohesion-ok", "g1")).toBeDefined();
    expect(reg.resolveObjectMethod("test/cohesion-ok", "m1")).toBeDefined();
  });
});
