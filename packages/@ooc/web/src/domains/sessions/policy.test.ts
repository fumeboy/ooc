import { describe, expect, it } from "bun:test";
import type { Stone } from "../stones";
import { defaultObjectId } from "./policy";

const stone = (objectId: string): Stone => ({ objectId, dir: `/stones/${objectId}` });

describe("defaultObjectId", () => {
  it("prefers supervisor as the default talk target when present", () => {
    expect(defaultObjectId([stone("agent"), stone("supervisor")])).toBe("supervisor");
  });

  it("falls back to the first stone when supervisor is absent", () => {
    expect(defaultObjectId([stone("agent"), stone("other")])).toBe("agent");
  });

  it("returns empty string for an empty list", () => {
    expect(defaultObjectId([])).toBe("");
  });
});
