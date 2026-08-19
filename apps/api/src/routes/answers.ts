import { AnswerService } from '@infomemory/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAccessContext } from '../plugins/access-context.js';

const bodySchema = z.object({
  query: z.string(),
  limit: z.number().optional(),
});

export function registerAnswerRoute(
  app: FastifyInstance,
  answerService: AnswerService,
): void {
  app.post('/answers', async (request) => answerService.answer(
    requireAccessContext(request),
    bodySchema.parse(request.body),
  ));
}
