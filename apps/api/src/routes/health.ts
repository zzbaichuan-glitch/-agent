import type { FastifyInstance } from 'fastify';

export interface HealthRouteOptions {
  llmEnabled: boolean;
  feishuConfigured: boolean;
  feishuNotificationsEnabled: boolean;
}

export function registerHealthRoute(
  app: FastifyInstance,
  options: HealthRouteOptions,
): void {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'infomemory-api',
    version: '0.1.0',
    searchMode: 'keyword',
    llmEnabled: options.llmEnabled,
    feishuConfigured: options.feishuConfigured,
    feishuNotificationsEnabled: options.feishuNotificationsEnabled,
    capabilities: [
      'pre_persistence_secret_redaction',
      'tenant_owner_access_boundaries',
      'idempotent_asset_ingestion',
      'keyword_evidence_search',
      'citation_gated_answers',
      'feishu_callback_foundation',
      'meeting_reminder_candidates',
      ...(options.feishuNotificationsEnabled ? ['feishu_outbound_notifications'] : []),
    ],
  }));
}
