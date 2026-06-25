/**
 * lark-client —— 经 env 配置的 lark SDK client 单例。
 *
 * env：
 *   FEISHU_APP_ID — app id（必需）
 *   FEISHU_APP_SECRET — app secret（必需）
 *   FEISHU_BASE_URL — 飞书 API 主机（缺省 https://open.feishu.cn）
 *
 * 缺一即返回未配置；调用方决定 stub 还是抛错。
 */
import * as lark from "@larksuiteoapi/node-sdk";

let _client: lark.Client | undefined;

export function isLarkConfigured(): boolean {
  return !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
}

export function getLarkClient(): lark.Client {
  if (_client) return _client;
  if (!isLarkConfigured()) {
    throw new Error("[lark-client] FEISHU_APP_ID / FEISHU_APP_SECRET 未配置");
  }
  _client = new lark.Client({
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!,
    domain: process.env.FEISHU_BASE_URL ?? lark.Domain.Feishu,
  });
  return _client;
}
