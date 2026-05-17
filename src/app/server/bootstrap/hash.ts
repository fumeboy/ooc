import { createHash } from "node:crypto";

/**
 * 对任意可 JSON 序列化值算稳定 hash，供前端"内容未变就别重渲染"的判断依据。
 *
 * 使用 SHA-1 hex；非加密强度，但对 thread / flows 这种结构化 JSON 的碰撞概率足够低。
 * 同一进程同一对象形状下 JSON.stringify 的 key 顺序稳定（沿用插入顺序），所以
 * 只要 service 构造响应对象时字段顺序固定，hash 就是稳定的。
 */
export function hashJson(value: unknown): string {
  return createHash("sha1").update(JSON.stringify(value)).digest("hex");
}
