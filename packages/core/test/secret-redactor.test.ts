import { describe, expect, it } from 'vitest';

import { redactSecrets } from '../src/security/secret-redactor.js';

describe('redactSecrets', () => {
  it('redacts an OpenAI-compatible API key without retaining the original', () => {
    const secret = ['sk', 'example1234567890ABCDEFGHJKLMNPQ'].join('-');
    const result = redactSecrets(`LLM_API_KEY=${secret}`);

    expect(result.redactedText).not.toContain(secret);
    expect(result.redactedText).toContain('[REDACTED:api_key:');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.type).toBe('api_key');
    expect(JSON.stringify(result.findings)).not.toContain(secret);
  });

  it('redacts bearer tokens while preserving the authorization scheme', () => {
    const token = 'example.bearer.token.with.sufficient.length';
    const result = redactSecrets(`Authorization: Bearer ${token}`);

    expect(result.redactedText).toMatch(/^Authorization: Bearer \[REDACTED:bearer_token:/);
    expect(result.redactedText).not.toContain(token);
  });

  it('redacts password assignments and connection-string passwords', () => {
    const result = redactSecrets([
      'password=example-password-value',
      'postgresql://service:database-password@db.internal:5432/app',
    ].join('\n'));

    expect(result.redactedText).toContain('password=[REDACTED:password:');
    expect(result.redactedText).toContain('postgresql://service:[REDACTED:database_password:');
    expect(result.redactedText).toContain('@db.internal:5432/app');
    expect(result.findings.map((finding) => finding.type)).toEqual([
      'password',
      'database_password',
    ]);
  });

  it('returns ordinary text unchanged', () => {
    const input = '项目数据库配置由平台组维护，详情见部署手册。';

    expect(redactSecrets(input)).toEqual({
      redactedText: input,
      findings: [],
    });
  });

  it('redacts multiple non-overlapping findings deterministically', () => {
    const apiKey = ['sk', 'anotherExample1234567890ABCDEF'].join('-');
    const input = `api_key=${apiKey}; pwd=another-password`;

    const first = redactSecrets(input);
    const second = redactSecrets(input);

    expect(first).toEqual(second);
    expect(first.findings).toHaveLength(2);
    expect(first.findings.every((finding) => finding.end > finding.start)).toBe(true);
  });
});
