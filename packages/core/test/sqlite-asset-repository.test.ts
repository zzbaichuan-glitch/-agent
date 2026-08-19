import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssetService } from '../src/services/asset-service.js';
import { SqliteAssetRepository } from '../src/repositories/sqlite-asset-repository.js';

describe('SqliteAssetRepository access boundaries', () => {
  let repository: SqliteAssetRepository;
  let service: AssetService;

  beforeEach(() => {
    repository = new SqliteAssetRepository(':memory:');
    service = new AssetService(repository);
  });

  afterEach(() => repository.close());

  it('never returns assets from another tenant', async () => {
    const asset = await service.ingest({ tenantId: 'tenant-a', userId: 'alice' }, {
      title: 'A 租户文档',
      content: '仅属于 A 租户。',
      idempotencyKey: 'a-1',
      visibility: 'tenant',
    });

    await expect(repository.findById(
      { tenantId: 'tenant-b', userId: 'bob' },
      asset.asset.id,
    )).resolves.toBeNull();
    await expect(repository.list(
      { tenantId: 'tenant-b', userId: 'bob' },
    )).resolves.toEqual([]);
  });

  it('shares tenant-visible assets but isolates owner-visible assets', async () => {
    const tenantAsset = await service.ingest({ tenantId: 'tenant-a', userId: 'alice' }, {
      title: '团队资料',
      content: '团队成员可见。',
      idempotencyKey: 'tenant-asset',
      visibility: 'tenant',
    });
    const privateAsset = await service.ingest({ tenantId: 'tenant-a', userId: 'alice' }, {
      title: '个人草稿',
      content: '仅上传者可见。',
      idempotencyKey: 'private-asset',
      visibility: 'owner',
    });

    const bobAssets = await repository.list({ tenantId: 'tenant-a', userId: 'bob' });

    expect(bobAssets.map((asset) => asset.id)).toContain(tenantAsset.asset.id);
    expect(bobAssets.map((asset) => asset.id)).not.toContain(privateAsset.asset.id);
    await expect(repository.findById(
      { tenantId: 'tenant-a', userId: 'bob' },
      privateAsset.asset.id,
    )).resolves.toBeNull();
  });

  it('requires a scoped access context on every read method', () => {
    expect(repository.list.length).toBeGreaterThanOrEqual(1);
    expect(repository.findById.length).toBeGreaterThanOrEqual(2);
  });
});
