/**
 * 飞书开放平台 API 客户端
 *
 * 提供 tenant_access_token 管理和消息发送能力。
 * 用于 OOC 系统与飞书 IM 的集成。
 */

import { consola } from "consola";

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
}

export class FeishuClient {
  private _config: FeishuConfig;
  private _tenantToken: string | null = null;
  private _tokenExpiresAt: number = 0;

  constructor(config: FeishuConfig) {
    this._config = config;
  }

  private async _getToken(): Promise<string> {
    if (this._tenantToken && Date.now() < this._tokenExpiresAt) {
      return this._tenantToken;
    }

    const resp = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this._config.appId,
        app_secret: this._config.appSecret,
      }),
    });

    const data = await resp.json() as { code: number; tenant_access_token: string; expire: number };
    if (data.code !== 0) throw new Error(`飞书 token 获取失败: ${JSON.stringify(data)}`);

    this._tenantToken = data.tenant_access_token;
    this._tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;
    return this._tenantToken;
  }

  async sendMessage(
    receiveIdType: "open_id" | "user_id" | "chat_id",
    receiveId: string,
    msgType: "text" | "interactive",
    content: string,
  ): Promise<{ messageId: string }> {
    const token = await this._getToken();
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ receive_id: receiveId, msg_type: msgType, content }),
      },
    );

    const data = await resp.json() as { code: number; data?: { message_id: string } };
    if (data.code !== 0) throw new Error(`飞书消息发送失败: ${JSON.stringify(data)}`);
    return { messageId: data.data!.message_id };
  }

  async replyMessage(
    messageId: string,
    msgType: "text" | "interactive",
    content: string,
  ): Promise<{ messageId: string }> {
    const token = await this._getToken();
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ msg_type: msgType, content }),
      },
    );

    const data = await resp.json() as { code: number; data?: { message_id: string } };
    if (data.code !== 0) throw new Error(`飞书回复失败: ${JSON.stringify(data)}`);
    return { messageId: data.data!.message_id };
  }
}
