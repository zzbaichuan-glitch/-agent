import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { AccessContext, SourceReference } from '../domain.js';
import type {
  AssetIngestResult,
  AssetRepository,
} from '../repositories/asset-repository.js';
import { redactSecrets } from '../security/secret-redactor.js';

const sourceSchema = z.object({
  type: z.enum(['manual', 'local_file', 'feishu_message', 'feishu_document']),
  externalId: z.string().trim().min(1).max(500).optional(),
  url: z.url().max(2_000).optional(),
});

const ingestAssetSchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(1_000_000),
  idempotencyKey: z.string().trim().min(1).max(500),
  visibility: z.enum(['tenant', 'owner']).default('owner'),
  source: sourceSchema.optional(),
});

const accessContextSchema = z.object({
  tenantId: z.string().trim().min(1).max(200),
  userId: z.string().trim().min(1).max(200),
});

export type IngestAssetCommand = z.input<typeof ingestAssetSchema>;

export interface AssetServiceOptions {
  idFactory?: () => string;
  now?: () => Date;
}

export class AssetService {
  readonly #idFactory: () => string;
  readonly #now: () => Date;

  constructor(
    private readonly repository: AssetRepository,
    options: AssetServiceOptions = {},
  ) {
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async ingest(
    contextInput: AccessContext,
    commandInput: IngestAssetCommand,
  ): Promise<AssetIngestResult> {
    const context = accessContextSchema.parse(contextInput);
    const command = ingestAssetSchema.parse(commandInput);
    const redaction = redactSecrets(command.content);
    const contentHash = createHash('sha256')
      .update(redaction.redactedText, 'utf8')
      .digest('hex');

    return this.repository.ingest({
      id: this.#idFactory(),
      context,
      visibility: command.visibility,
      title: command.title,
      redactedContent: redaction.redactedText,
      contentHash,
      source: this.#normalizeSource(command.source),
      secretFindingCount: redaction.findings.length,
      idempotencyKey: command.idempotencyKey,
      createdAt: this.#now().toISOString(),
    });
  }

  #normalizeSource(source: z.output<typeof sourceSchema> | undefined): SourceReference {
    if (!source) return { type: 'manual' };
    return {
      type: source.type,
      ...(source.externalId ? { externalId: source.externalId } : {}),
      ...(source.url ? { url: source.url } : {}),
    };
  }
}
