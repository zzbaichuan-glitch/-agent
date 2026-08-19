export interface AccessContext {
  tenantId: string;
  userId: string;
}

export type AssetVisibility = 'tenant' | 'owner';

export interface SourceReference {
  type: 'manual' | 'local_file' | 'feishu_message' | 'feishu_document';
  externalId?: string;
  url?: string;
}

export interface InformationAsset {
  id: string;
  tenantId: string;
  ownerId: string;
  visibility: AssetVisibility;
  title: string;
  redactedContent: string;
  contentHash: string;
  sources: SourceReference[];
  secretFindingCount: number;
  createdAt: string;
}
