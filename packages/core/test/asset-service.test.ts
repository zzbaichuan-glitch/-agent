import { afterEach, describe, expect, it } from 'vitest';

import { AssetService } from '../src/services/asset-service.js';
import { SqliteAssetRepository } from '../src/repositories/sqlite-asset-repository.js';

const alice = { tenantId: 'tenant-a', userId: 'alice' };

describe('AssetService', () => {
  const repositories: SqliteAssetRepository[] = [];

  afterEach(() => {
    for (const repository of repositories.splice(0)) repository.close();
  });

  function createService(): AssetService {
    const repository = new SqliteAssetRepository(':memory:');
    repositories.push(repository);
    return new AssetService(repository);
  }

  it('redacts secrets before any content is persisted', async () => {
    const service = createService();
    const secret = ['sk', 'serviceExample1234567890ABCDEFG'].join('-');

    const result = await service.ingest(alice, {
      title: '生产环境配置',
      content: `API key: ${secret}`,
      idempotencyKey: 'message-1',
    });

    expect(result.asset.redactedContent).not.toContain(secret);
    expect(result.asset.redactedContent).toContain('[REDACTED:api_key:');
    expect(result.asset.secretFindingCount).toBe(1);
  });

  it('is idempotent for the same tenant and idempotency key', async () => {
    const service = createService();
    const command = {
      title: '项目结论',
      content: '方案 A 已通过评审。',
      idempotencyKey: 'feishu-event-1',
    };

    const first = await service.ingest(alice, command);
    const second = await service.ingest(alice, command);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.deduplicatedBy).toBe('idempotency');
    expect(second.asset.id).toBe(first.asset.id);
  });

  it('deduplicates identical safe content and keeps both source locations', async () => {
    const service = createService();
    const first = await service.ingest(alice, {
      title: '部署说明',
      content: '服务通过 443 端口提供 HTTPS。',
      idempotencyKey: 'source-1',
      source: { type: 'manual', externalId: 'manual-1' },
    });
    const second = await service.ingest(alice, {
      title: '部署说明副本',
      content: '服务通过 443 端口提供 HTTPS。',
      idempotencyKey: 'source-2',
      source: {
        type: 'feishu_document',
        externalId: 'doc-1',
        url: 'https://example.feishu.cn/docx/doc-1',
      },
    });

    expect(second.created).toBe(false);
    expect(second.deduplicatedBy).toBe('content_hash');
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.sources).toHaveLength(2);
  });

  it('rejects blank content', async () => {
    const service = createService();

    await expect(service.ingest(alice, {
      title: '空内容',
      content: '   ',
      idempotencyKey: 'empty-1',
    })).rejects.toThrow('content');
  });
});
