import {
  AssetService,
  type AssetRepository,
} from '@infomemory/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAccessContext } from '../plugins/access-context.js';

const bodySchema = z.object({
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(1_000_000),
  visibility: z.enum(['tenant', 'owner']).optional(),
  source: z.object({
    type: z.enum(['manual', 'local_file', 'feishu_message', 'feishu_document']),
    externalId: z.string().optional(),
    url: z.string().optional(),
  }).optional(),
});

export function registerAssetRoutes(
  app: FastifyInstance,
  assetService: AssetService,
  repository: AssetRepository,
): void {
  app.post('/assets', async (request, reply) => {
    const context = requireAccessContext(request);
    const body = bodySchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      return reply.code(400).send({
        error: 'idempotency_key_required',
        message: 'idempotency-key header is required',
      });
    }
    const result = await assetService.ingest(context, {
      ...body,
      idempotencyKey: idempotencyKey.trim(),
    });
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.get('/assets', async (request) => {
    const assets = await repository.list(requireAccessContext(request));
    return { assets };
  });
}
