import { DatabaseSync } from 'node:sqlite';

import type {
  AccessContext,
  InformationAsset,
  SourceReference,
} from '../domain.js';
import type {
  AssetIngestResult,
  AssetListOptions,
  AssetRepository,
  DeduplicatedBy,
  PersistAssetInput,
} from './asset-repository.js';

type Row = Record<string, unknown>;

export class SqliteAssetRepository implements AssetRepository {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path);
    this.#database.exec('PRAGMA foreign_keys = ON;');
    this.#database.exec('PRAGMA journal_mode = WAL;');
    this.#initializeSchema();
  }

  async ingest(input: PersistAssetInput): Promise<AssetIngestResult> {
    this.#database.exec('BEGIN IMMEDIATE;');
    try {
      const idempotent = this.#database.prepare(`
        SELECT asset_id
        FROM asset_ingestions
        WHERE tenant_id = ? AND idempotency_key = ?
      `).get(input.context.tenantId, input.idempotencyKey) as Row | undefined;

      if (idempotent) {
        const assetId = String(idempotent.asset_id);
        this.#database.exec('COMMIT;');
        return this.#deduplicatedResult(assetId, 'idempotency');
      }

      const duplicate = this.#database.prepare(`
        SELECT id
        FROM assets
        WHERE tenant_id = ?
          AND owner_id = ?
          AND visibility = ?
          AND content_hash = ?
        LIMIT 1
      `).get(
        input.context.tenantId,
        input.context.userId,
        input.visibility,
        input.contentHash,
      ) as Row | undefined;

      if (duplicate) {
        const assetId = String(duplicate.id);
        this.#insertSource(assetId, input.source);
        this.#insertIngestion(input.context.tenantId, input.idempotencyKey, assetId);
        this.#database.exec('COMMIT;');
        return this.#deduplicatedResult(assetId, 'content_hash');
      }

      this.#database.prepare(`
        INSERT INTO assets (
          id, tenant_id, owner_id, visibility, title, redacted_content,
          content_hash, secret_finding_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.context.tenantId,
        input.context.userId,
        input.visibility,
        input.title,
        input.redactedContent,
        input.contentHash,
        input.secretFindingCount,
        input.createdAt,
      );
      this.#insertSource(input.id, input.source);
      this.#insertIngestion(input.context.tenantId, input.idempotencyKey, input.id);
      this.#database.exec('COMMIT;');

      const asset = this.#loadAssetById(input.id);
      if (!asset) throw new Error('Asset was not persisted');
      return { asset, created: true };
    } catch (error) {
      this.#database.exec('ROLLBACK;');
      throw error;
    }
  }

  async findById(
    context: AccessContext,
    id: string,
  ): Promise<InformationAsset | null> {
    const row = this.#database.prepare(`
      SELECT *
      FROM assets
      WHERE id = ?
        AND tenant_id = ?
        AND (visibility = 'tenant' OR owner_id = ?)
      LIMIT 1
    `).get(id, context.tenantId, context.userId) as Row | undefined;

    return row ? this.#mapAsset(row) : null;
  }

  async list(
    context: AccessContext,
    options: AssetListOptions = {},
  ): Promise<InformationAsset[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const rows = this.#database.prepare(`
      SELECT *
      FROM assets
      WHERE tenant_id = ?
        AND (visibility = 'tenant' OR owner_id = ?)
      ORDER BY created_at DESC, id ASC
      LIMIT ?
    `).all(context.tenantId, context.userId, limit) as Row[];

    return rows.map((row) => this.#mapAsset(row));
  }

  close(): void {
    this.#database.close();
  }

  #initializeSchema(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('tenant', 'owner')),
        title TEXT NOT NULL,
        redacted_content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        secret_finding_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS assets_safe_content_identity
        ON assets (tenant_id, owner_id, visibility, content_hash);
      CREATE INDEX IF NOT EXISTS assets_access_lookup
        ON assets (tenant_id, visibility, owner_id, created_at);

      CREATE TABLE IF NOT EXISTS asset_sources (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        source_identity TEXT NOT NULL,
        source_type TEXT NOT NULL,
        external_id TEXT,
        source_url TEXT,
        PRIMARY KEY (asset_id, source_identity)
      );

      CREATE TABLE IF NOT EXISTS asset_ingestions (
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        PRIMARY KEY (tenant_id, idempotency_key)
      );
    `);
  }

  #insertSource(assetId: string, source: SourceReference): void {
    const identity = [source.type, source.externalId ?? '', source.url ?? ''].join(':');
    this.#database.prepare(`
      INSERT OR IGNORE INTO asset_sources (
        asset_id, source_identity, source_type, external_id, source_url
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      assetId,
      identity,
      source.type,
      source.externalId ?? null,
      source.url ?? null,
    );
  }

  #insertIngestion(tenantId: string, key: string, assetId: string): void {
    this.#database.prepare(`
      INSERT INTO asset_ingestions (tenant_id, idempotency_key, asset_id)
      VALUES (?, ?, ?)
    `).run(tenantId, key, assetId);
  }

  #deduplicatedResult(assetId: string, by: DeduplicatedBy): AssetIngestResult {
    const asset = this.#loadAssetById(assetId);
    if (!asset) throw new Error('Deduplicated asset no longer exists');
    return { asset, created: false, deduplicatedBy: by };
  }

  #loadAssetById(id: string): InformationAsset | null {
    const row = this.#database.prepare('SELECT * FROM assets WHERE id = ? LIMIT 1')
      .get(id) as Row | undefined;
    return row ? this.#mapAsset(row) : null;
  }

  #mapAsset(row: Row): InformationAsset {
    const id = String(row.id);
    const sourceRows = this.#database.prepare(`
      SELECT source_type, external_id, source_url
      FROM asset_sources
      WHERE asset_id = ?
      ORDER BY source_identity ASC
    `).all(id) as Row[];

    return {
      id,
      tenantId: String(row.tenant_id),
      ownerId: String(row.owner_id),
      visibility: row.visibility === 'owner' ? 'owner' : 'tenant',
      title: String(row.title),
      redactedContent: String(row.redacted_content),
      contentHash: String(row.content_hash),
      sources: sourceRows.map((sourceRow) => this.#mapSource(sourceRow)),
      secretFindingCount: Number(row.secret_finding_count),
      createdAt: String(row.created_at),
    };
  }

  #mapSource(row: Row): SourceReference {
    const source: SourceReference = {
      type: this.#sourceType(String(row.source_type)),
    };
    if (row.external_id !== null && row.external_id !== undefined) {
      source.externalId = String(row.external_id);
    }
    if (row.source_url !== null && row.source_url !== undefined) {
      source.url = String(row.source_url);
    }
    return source;
  }

  #sourceType(value: string): SourceReference['type'] {
    const supported: SourceReference['type'][] = [
      'manual',
      'local_file',
      'feishu_message',
      'feishu_document',
    ];
    return supported.includes(value as SourceReference['type'])
      ? value as SourceReference['type']
      : 'manual';
  }
}
