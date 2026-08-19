import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('InfoMemory API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp({
      databasePath: ':memory:',
      logger: false,
      feishuVerificationToken: 'verification-token-for-tests',
    });
  });

  afterEach(async () => app.close());

  it('reports truthful health and capability information', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'infomemory-api',
      searchMode: 'keyword',
      llmEnabled: false,
    });
  });

  it('requires tenant and user headers for product endpoints', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/assets' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'access_context_required',
      message: 'x-tenant-id and x-user-id headers are required',
    });
  });

  it('ingests redacted assets and lists them within the tenant boundary', async () => {
    const secret = ['sk', 'apiTestExample1234567890ABCDEFG'].join('-');
    const created = await app.inject({
      method: 'POST',
      url: '/v1/assets',
      headers: accessHeaders('tenant-a', 'alice', { 'idempotency-key': 'api-asset-1' }),
      payload: {
        title: '配置说明',
        content: `密钥：${secret}`,
        visibility: 'tenant',
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(secret);
    expect(created.json().asset.secretFindingCount).toBe(1);

    const sameTenant = await app.inject({
      method: 'GET',
      url: '/v1/assets',
      headers: accessHeaders('tenant-a', 'bob'),
    });
    const otherTenant = await app.inject({
      method: 'GET',
      url: '/v1/assets',
      headers: accessHeaders('tenant-b', 'bob'),
    });

    expect(sameTenant.json().assets).toHaveLength(1);
    expect(otherTenant.json().assets).toEqual([]);
  });

  it('searches evidence and degrades answers when the LLM is disabled', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/assets',
      headers: accessHeaders('tenant-a', 'alice', { 'idempotency-key': 'project-1' }),
      payload: {
        title: '星海项目数据库配置',
        content: '生产数据库配置由平台组维护。',
        visibility: 'tenant',
      },
    });

    const searched = await app.inject({
      method: 'POST',
      url: '/v1/search',
      headers: accessHeaders('tenant-a', 'alice'),
      payload: { query: '数据库配置' },
    });
    const answered = await app.inject({
      method: 'POST',
      url: '/v1/answers',
      headers: accessHeaders('tenant-a', 'alice'),
      payload: { query: '数据库配置由谁维护' },
    });

    expect(searched.statusCode).toBe(200);
    expect(searched.json()).toMatchObject({ mode: 'keyword' });
    expect(searched.json().evidence).toHaveLength(1);
    expect(answered.json()).toMatchObject({
      status: 'evidence_only',
      degradedReason: 'llm_disabled',
    });
  });

  it('returns stable validation errors without echoing submitted content', async () => {
    const sensitiveInput = 'do-not-echo-this-value';
    const response = await app.inject({
      method: 'POST',
      url: '/v1/assets',
      headers: accessHeaders('tenant-a', 'alice'),
      payload: { title: '', content: sensitiveInput },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'validation_error' });
    expect(response.body).not.toContain(sensitiveInput);
  });

  it('lists private reminders and supports confirmation/completion updates', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/connectors/feishu/events',
      payload: {
        type: 'url_verification',
        token: 'verification-token-for-tests',
        challenge: 'unused',
      },
    });
    expect(created.statusCode).toBe(200);

    const event = {
      header: {
        event_id: 'reminder-api-event',
        event_type: 'im.message.receive_v1',
        tenant_key: 'tenant-a',
        token: 'verification-token-for-tests',
      },
      event: {
        sender: { sender_id: { open_id: 'alice' } },
        message: {
          message_id: 'reminder-message',
          message_type: 'text',
          content: JSON.stringify({ text: '下午要开会，先帮我记着。' }),
        },
      },
    };
    const ingested = await app.inject({
      method: 'POST',
      url: '/v1/connectors/feishu/events',
      payload: event,
    });
    const reminder = ingested.json().reminder as { id: string; status: string };
    expect(reminder.status).toBe('needs_confirmation');

    const updated = await app.inject({
      method: 'POST',
      url: `/v1/reminders/${reminder.id}/status`,
      headers: accessHeaders('tenant-a', 'alice'),
      payload: { status: 'completed' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().reminder.status).toBe('completed');
    const hidden = await app.inject({
      method: 'GET',
      url: '/v1/reminders',
      headers: accessHeaders('tenant-a', 'bob'),
    });
    expect(hidden.json().reminders).toEqual([]);
  });
});

function accessHeaders(
  tenantId: string,
  userId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    'x-tenant-id': tenantId,
    'x-user-id': userId,
    ...extra,
  };
}
