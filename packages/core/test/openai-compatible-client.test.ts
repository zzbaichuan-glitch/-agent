import { describe, expect, it, vi } from 'vitest';

import {
  LlmGatewayError,
  OpenAiCompatibleClient,
  type FetchLike,
} from '../src/llm/openai-compatible-client.js';

const evidence = [{
  citationId: 'asset:1',
  assetId: '1',
  title: '项目说明',
  snippet: '数据库配置由平台组维护。',
  score: 100,
  sources: [{ type: 'manual' as const }],
  createdAt: '2026-08-19T00:00:00.000Z',
}];

describe('OpenAiCompatibleClient', () => {
  it('normalizes the base URL and sends a minimal citation prompt', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const fetchMock: FetchLike = vi.fn(async (input, init) => {
      requestedUrl = String(input);
      requestedInit = init;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '由平台组维护。[S1]' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://llm.example.edu/v1/',
      apiKey: 'test-key-not-a-real-secret',
      model: 'test-model',
      fetch: fetchMock,
    });

    const result = await client.generate({ query: '由谁维护？', evidence });

    expect(result).toBe('由平台组维护。[S1]');
    expect(requestedUrl).toBe('https://llm.example.edu/v1/chat/completions');
    const headers = new Headers(requestedInit?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key-not-a-real-secret');
    const body = JSON.parse(String(requestedInit?.body)) as Record<string, unknown>;
    expect(body.model).toBe('test-model');
    expect(JSON.stringify(body)).toContain('[S1]');
  });

  it('does not duplicate a chat-completions suffix', async () => {
    const fetchMock: FetchLike = vi.fn(async (input) => new Response(JSON.stringify({
      choices: [{ message: { content: `called ${String(input)} [S1]` } }],
    }), { status: 200 }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://llm.example.edu/v1/chat/completions',
      apiKey: 'test-key',
      model: 'test-model',
      fetch: fetchMock,
    });

    await client.generate({ query: 'test', evidence });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://llm.example.edu/v1/chat/completions',
      expect.any(Object),
    );
  });

  it('sanitizes non-success responses and invalid payloads', async () => {
    const secretBody = ['sk', 'must-not-appear-in-error-1234567890'].join('-');
    const failingClient = new OpenAiCompatibleClient({
      baseUrl: 'https://llm.example.edu/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetch: vi.fn(async () => new Response(secretBody, { status: 502 })),
    });
    const invalidClient = new OpenAiCompatibleClient({
      baseUrl: 'https://llm.example.edu/v1',
      apiKey: 'test-key',
      model: 'test-model',
      fetch: vi.fn(async () => new Response('{}', { status: 200 })),
    });

    const error = await failingClient.generate({ query: 'test', evidence })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmGatewayError);
    expect(String(error)).toContain('HTTP 502');
    expect(String(error)).not.toContain(secretBody);
    await expect(invalidClient.generate({ query: 'test', evidence }))
      .rejects.toThrow('invalid response');
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const fetchMock: FetchLike = vi.fn((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const client = new OpenAiCompatibleClient({
      baseUrl: 'https://llm.example.edu/v1',
      apiKey: 'test-key',
      model: 'test-model',
      timeoutMs: 5,
      fetch: fetchMock,
    });

    await expect(client.generate({ query: 'test', evidence }))
      .rejects.toThrow('timed out');
  });
});
