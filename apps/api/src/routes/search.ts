import { SearchService } from '@infomemory/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAccessContext } from '../plugins/access-context.js';

const bodySchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
});

export function registerSearchRoute(
  app: FastifyInstance,
  searchService: SearchService,
): void {
  app.post('/search', async (request) => searchService.search(
    requireAccessContext(request),
    bodySchema.parse(request.body),
  ));
}
