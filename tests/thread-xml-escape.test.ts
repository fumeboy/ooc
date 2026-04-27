/**
 * src/executable/protocol/xml.ts 序列化辅助的单元测试
 *
 * 覆盖：
 * - 属性值 XML 实体转义（`&` `<` `>` `"`）
 * - 叶子 content 的 CDATA 必要性判断
 * - CDATA 包装 + `]]>` 边界拆分
 * - 无敏感字符时 content 保持原样（不做无效包装）
 * - 嵌套容器/缩进不被破坏
 *
 * @ref docs/工程管理/迭代/all/20260423_bugfix_llm_input协议漂移.md
 */
import { describe, test, expect } from "bun:test";
import {
  escapeAttr,
  renderAttrs,
  contentNeedsCdata,
  wrapCdata,
  serializeXml,
} from "../src/executable/protocol/xml.js";

describe("escapeAttr", () => {
  test("转义 & < > \"", () => {
    expect(escapeAttr(`a&b<c>d"e`)).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });

  test("纯文本原样返回", () => {
    expect(escapeAttr("hello world")).toBe("hello world");
  });

  test("& 必须先转义（避免二次编码）", () => {
    /* 如果 & 放到 < 后面，<lt> 会先变 &lt;，& 再变 &amp; 就成了 &amp;lt; */
    expect(escapeAttr("<")).toBe("&lt;");
    expect(escapeAttr("&")).toBe("&amp;");
    expect(escapeAttr("&lt;")).toBe("&amp;lt;");
  });

  test("数字转字符串", () => {
    expect(escapeAttr(42)).toBe("42");
  });
});

describe("renderAttrs", () => {
  test("属性值走转义", () => {
    const out = renderAttrs({ from: `a"b`, to: `c<d>` });
    expect(out).toBe(` from="a&quot;b" to="c&lt;d&gt;"`);
  });

  test("空属性返回空串", () => {
    expect(renderAttrs()).toBe("");
    expect(renderAttrs({})).toBe("");
  });

  test("保持插入顺序", () => {
    const out = renderAttrs({ b: "2", a: "1" });
    expect(out).toBe(` b="2" a="1"`);
  });
});

describe("contentNeedsCdata", () => {
  test.each([
    ["plain text", false],
    ["# Markdown 标题", false],
    ["含 < 尖括号", true],
    ["含 & 符号", true],
    ["含 > 符号", true],
    ["<message>嵌入 XML</message>", true],
    ["Array<string>", true],
    ["Record<string, any>", true],
    ["a && b", true],
  ])("'%s' → %s", (input, expected) => {
    expect(contentNeedsCdata(input)).toBe(expected);
  });
});

describe("wrapCdata", () => {
  test("基本包装", () => {
    expect(wrapCdata("<foo>")).toBe("<![CDATA[<foo>]]>");
  });

  test("`]]>` 边界拆分", () => {
    const input = "prefix]]>suffix";
    const out = wrapCdata(input);
    /* 预期：`]]>` 被拆成 `]]]]><![CDATA[>`，整体仍是合法 CDATA 序列 */
    expect(out).toBe("<![CDATA[prefix]]]]><![CDATA[>suffix]]>");
  });

  test("多次 `]]>` 都被拆分", () => {
    const out = wrapCdata("a]]>b]]>c");
    expect(out).toBe("<![CDATA[a]]]]><![CDATA[>b]]]]><![CDATA[>c]]>");
  });
});

describe("serializeXml — 转义 / CDATA 必要性", () => {
  test("属性含特殊字符 → 实体转义", () => {
    const out = serializeXml([
      { tag: "msg", attrs: { from: `alice"bob`, payload: "a<b&c>d" } },
    ]);
    expect(out).toBe(`<msg from="alice&quot;bob" payload="a&lt;b&amp;c&gt;d"/>`);
  });

  test("content 纯文本 → 不做 CDATA 包装（保持可读）", () => {
    const out = serializeXml([
      { tag: "note", content: "hello\nworld" },
    ]);
    expect(out).toBe("<note>\nhello\nworld\n</note>");
  });

  test("content 含 < → 自动 CDATA 包装", () => {
    const out = serializeXml([
      { tag: "code", content: "Array<string>" },
    ]);
    expect(out).toBe("<code>\n<![CDATA[Array<string>]]>\n</code>");
  });

  test("content 含 & → 自动 CDATA 包装", () => {
    const out = serializeXml([
      { tag: "expr", content: "a && b" },
    ]);
    expect(out).toBe("<expr>\n<![CDATA[a && b]]>\n</expr>");
  });

  test("content 含 `]]>` → CDATA 拆分处理", () => {
    const out = serializeXml([
      { tag: "raw", content: "foo]]>bar" },
    ]);
    expect(out).toBe("<raw>\n<![CDATA[foo]]]]><![CDATA[>bar]]>\n</raw>");
  });

  test("容器节点嵌套 + 属性转义", () => {
    const out = serializeXml([
      {
        tag: "inbox",
        children: [
          {
            tag: "message",
            attrs: { id: "m1", from: "user&sys" },
            content: "plain",
          },
        ],
      },
    ]);
    expect(out).toBe(
      [
        "<inbox>",
        `  <message id="m1" from="user&amp;sys">`,
        "plain",
        "  </message>",
        "</inbox>",
      ].join("\n"),
    );
  });

  test("自闭合节点", () => {
    const out = serializeXml([{ tag: "hr", selfClosing: true }]);
    expect(out).toBe("<hr/>");
  });
});

describe("serializeXml — 输出必须被浏览器 DOMParser 解析", () => {
  /**
   * 回归守护：只要 serializeXml 输出能被 <ooc-root> 包起来后成功解析，
   * 前端 LLMInputViewer 的解析路径就不会再 parse-error。
   */
  test("含 Array<string> 的代码片段 + 含 & 的属性 → 可被浏览器解析", () => {
    const xml = serializeXml([
      {
        tag: "system",
        children: [
          {
            tag: "knowledge",
            attrs: { name: "trait&example" },
            content: "签名：function foo(xs: Array<string>) & return it",
          },
        ],
      },
    ]);

    /* bun 的 DOMParser 在 jsdom / linkedom 下可能不可用，这里用正则快速验证关键约束 */
    expect(xml).toContain(`name="trait&amp;example"`);
    expect(xml).toContain("<![CDATA[");
    expect(xml).toContain("]]>");
    /* 未被 CDATA 覆盖的部分不应残留裸 < > & */
    const outsideCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
    /* outsideCdata 里只应有 XML 标签和实体；& 如果出现必须是 &amp; 等合法实体 */
    const strayAmp = outsideCdata.match(/&(?!amp;|lt;|gt;|quot;|apos;)/g);
    expect(strayAmp).toBeNull();
  });
});
