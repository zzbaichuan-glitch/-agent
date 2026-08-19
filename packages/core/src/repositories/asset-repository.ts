import type {
  AccessContext,
  AssetVisibility,
  InformationAsset,
  SourceReference,
} from '../domain.js';

export type DeduplicatedBy = 'idempotency' | 'content_hash';

export interface PersistAssetInput {
  id: string;
  context: AccessContext;
  visibility: AssetVisibility;
  title: string;
  redactedContent: string;
  contentHash: string;
  source: SourceReference;
  secretFindingCount: number;
  idempotencyKey: string;
  createdAt: string;
}

export interface AssetIngestResult {
  asset: InformationAsset;
  created: boolean;
  deduplicatedBy?: DeduplicatedBy;
}

export interface AssetListOptions {
  limit?: number;
}

export interface AssetRepository {
  ingest(input: PersistAssetInput): Promise<AssetIngestResult>;
  findById(context: AccessContext, id: string): Promise<InformationAsset | null>;
  list(context: AccessContext, options?: AssetListOptions): Promise<InformationAsset[]>;
}
