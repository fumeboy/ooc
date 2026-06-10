import { describe, expect, test } from "bun:test";
import { parseMentions } from "@ooc/core/_shared/utils/mention.js";

describe("parseMentions", () => {
  test("simple @objectId at start of string", () => {
    expect(parseMentions("@alice please review")).toEqual(["alice"]);
  });

  test("@objectId after whitespace", () => {
    expect(parseMentions("hi @critic @reviewer")).toEqual(["critic", "reviewer"]);
  });

  test("rejects email-style: prefix is non-whitespace", () => {
    expect(parseMentions("contact user@example.com please")).toEqual([]);
  });

  test("rejects backtick-prefixed: `@deprecated`", () => {
    expect(parseMentions("`@deprecated function`")).toEqual([]);
  });

  test("rejects names starting with digit or non-letter", () => {
    expect(parseMentions("@1abc @-illegal @_x valid")).toEqual([]);
  });

  test("allows digits / dashes / underscores after first letter", () => {
    expect(parseMentions("hi @a_b-2 done")).toEqual(["a_b-2"]);
  });

  test("dedupes repeated mentions, keeping first occurrence order", () => {
    expect(parseMentions("@alice @bob @alice")).toEqual(["alice", "bob"]);
  });

  test("empty string -> empty array", () => {
    expect(parseMentions("")).toEqual([]);
  });

  test("text without @ -> empty array", () => {
    expect(parseMentions("plain prose with no mention")).toEqual([]);
  });

  test("@ at very start (no preceding char)", () => {
    expect(parseMentions("@first then text")).toEqual(["first"]);
  });

  test("mention followed by punctuation", () => {
    expect(parseMentions("ping @alice, please")).toEqual(["alice"]);
  });
});
