import { DatabaseSync } from 'node:sqlite';

import type {
  AccessContext,
  InformationAsset,
  Reminder,
  ReminderStatus,
  SourceReference,
} from '../domain.js';
import type {
  AssetIngestResult,
  AssetListOptions,
  AssetRepository,
  DeduplicatedBy,
  PersistAssetInput,
} from './asset-repository.js';
import type {
  PersistReminderInput,
  ReminderListOptions,
  ReminderRepository,
} from './reminder-repository.js';

type Row = Record<string, unknown>;

export class SqliteAssetRepository implements AssetRepository, ReminderRepository {
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

  async createReminder(input: PersistReminderInput): Promise<Reminder> {
    try {
      this.#database.prepare(`
        INSERT INTO reminders (
          id, tenant_id, user_id, title, starts_at, remind_at, status,
          precision, source_asset_id, source_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.context.tenantId,
        input.context.userId,
        input.title,
        input.startsAt,
        input.remindAt,
        input.status,
        input.precision,
        input.sourceAssetId ?? null,
        input.sourceEventId ?? null,
        input.createdAt,
      );
    } catch (error) {
      if (input.sourceEventId && String(error).includes('UNIQUE constraint failed')) {
        const existing = await this.findReminderBySourceEvent(input.context, input.sourceEventId);
        if (existing) return existing;
      }
      throw error;
    }
    const reminder = this.#loadReminderById(input.id);
    if (!reminder) throw new Error('Reminder was not persisted');
    return reminder;
  }

  async findReminderBySourceEvent(
    context: AccessContext,
    sourceEventId: string,
  ): Promise<Reminder | null> {
    const row = this.#database.prepare(`
      SELECT * FROM reminders
      WHERE tenant_id = ? AND user_id = ? AND source_event_id = ?
      LIMIT 1
    `).get(context.tenantId, context.userId, sourceEventId) as Row | undefined;
    return row ? this.#mapReminder(row) : null;
  }

  async findReminder(context: AccessContext, id: string): Promise<Reminder | null> {
    const row = this.#database.prepare(`
      SELECT * FROM reminders
      WHERE id = ? AND tenant_id = ? AND user_id = ?
      LIMIT 1
    `).get(id, context.tenantId, context.userId) as Row | undefined;
    return row ? this.#mapReminder(row) : null;
  }

  async listReminders(
    context: AccessContext,
    options: ReminderListOptions = {},
  ): Promise<Reminder[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const offset = Math.max(0, Math.min(options.offset ?? 0, 100_000));
    const statuses = options.status
      ? Array.isArray(options.status) ? options.status : [options.status]
      : [];
    const clauses = ['tenant_id = ?', 'user_id = ?'];
    const values: Array<string | number> = [context.tenantId, context.userId];
    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      values.push(...statuses);
    }
    if (options.dueBefore) {
      clauses.push('remind_at <= ?');
      values.push(options.dueBefore);
    }
    const rows = this.#database.prepare(`
      SELECT * FROM reminders
      WHERE ${clauses.join(' AND ')}
      ORDER BY starts_at ASC, id ASC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as Row[];
    return rows.map((row) => this.#mapReminder(row));
  }

  async updateReminderStatus(
    context: AccessContext,
    id: string,
    status: ReminderStatus,
  ): Promise<Reminder | null> {
    const result = this.#database.prepare(`
      UPDATE reminders SET status = ?
      WHERE id = ? AND tenant_id = ? AND user_id = ?
    `).run(status, id, context.tenantId, context.userId);
    if (Number(result.changes) === 0) return null;
    return this.findReminder(context, id);
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

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        remind_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('scheduled', 'needs_confirmation', 'completed', 'cancelled')),
        precision TEXT NOT NULL CHECK (precision IN ('exact', 'period', 'inferred')),
        source_asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
        source_event_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, user_id, source_event_id)
      );
      CREATE INDEX IF NOT EXISTS reminders_due_lookup
        ON reminders (tenant_id, user_id, status, remind_at, starts_at);
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

  #loadReminderById(id: string): Reminder | null {
    const row = this.#database.prepare('SELECT * FROM reminders WHERE id = ? LIMIT 1')
      .get(id) as Row | undefined;
    return row ? this.#mapReminder(row) : null;
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

  #mapReminder(row: Row): Reminder {
    const reminder: Reminder = {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      userId: String(row.user_id),
      title: String(row.title),
      startsAt: String(row.starts_at),
      remindAt: String(row.remind_at),
      status: this.#reminderStatus(String(row.status)),
      precision: this.#reminderPrecision(String(row.precision)),
      createdAt: String(row.created_at),
    };
    if (row.source_asset_id !== null && row.source_asset_id !== undefined) {
      reminder.sourceAssetId = String(row.source_asset_id);
    }
    if (row.source_event_id !== null && row.source_event_id !== undefined) {
      reminder.sourceEventId = String(row.source_event_id);
    }
    return reminder;
  }

  #reminderStatus(value: string): ReminderStatus {
    const supported: ReminderStatus[] = ['scheduled', 'needs_confirmation', 'completed', 'cancelled'];
    return supported.includes(value as ReminderStatus) ? value as ReminderStatus : 'scheduled';
  }

  #reminderPrecision(value: string): Reminder['precision'] {
    const supported: Reminder['precision'][] = ['exact', 'period', 'inferred'];
    return supported.includes(value as Reminder['precision'])
      ? value as Reminder['precision']
      : 'inferred';
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
