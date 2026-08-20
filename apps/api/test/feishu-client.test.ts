import { describe, expect, it, vi } from 'vitest';

import {
  FeishuApiError,
  FeishuClient,
} from '../src/feishu/feishu-client.js';

describe('FeishuClient', () => {
  it('caches tenant access tokens and sends a text message', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/tenant_access_token/internal')) {
        return new Response(JSON.stringify({
          code: 0,
          tenant_access_token: 'tenant-token',
          expire: 7200,
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 0,
        data: { message_id: 'message-1' },
      }), { status: 200 });
    });
    const client = new FeishuClient({
      baseUrl: 'https://open.feishu.cn/',
      appId: 'cli_test',
      appSecret: 'secret-not-real',
      fetch: fetchMock,
      now: () => 1_000_000,
    });

    await expect(client.sendText('ou_user_1', '会议提醒')).resolves.toEqual({ messageId: 'message-1' });
    await expect(client.sendText('ou_user_1', '第二次提醒')).resolves.toEqual({ messageId: 'message-1' });

    expect(calls.filter((call) => call.url.includes('/tenant_access_token/internal'))).toHaveLength(1);
    const messageCall = calls.find((call) => call.url.includes('/im/v1/messages'));
    expect(messageCall?.url).toContain('receive_id_type=open_id');
    expect(new Headers(messageCall?.init?.headers).get('authorization')).toBe('Bearer tenant-token');
    expect(JSON.parse(String(messageCall?.init?.body))).toMatchObject({
      receive_id: 'ou_user_1',
      msg_type: 'text',
    });
  });

  it('does not expose provider bodies or secrets in errors', async () => {
    const secret = 'app-secret-must-not-leak';
    const client = new FeishuClient({
      baseUrl: 'https://open.feishu.cn',
      appId: 'cli_test',
      appSecret: secret,
      fetch: vi.fn(async () => new Response(secret, { status: 500 })),
    });

    const error = await client.sendText('ou_user_1', 'test').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FeishuApiError);
    expect(String(error)).not.toContain(secret);
    expect(String(error)).toContain('HTTP 500');
  });

  it('maps provider code failures to a safe error', async () => {
    const client = new FeishuClient({
      baseUrl: 'https://open.feishu.cn',
      appId: 'cli_test',
      appSecret: 'secret',
      fetch: vi.fn(async () => new Response(JSON.stringify({ code: 999, msg: 'private provider detail' }), { status: 200 })),
    });

    await expect(client.sendText('ou_user_1', 'test'))
      .rejects.toThrow('invalid response');
  });
});
