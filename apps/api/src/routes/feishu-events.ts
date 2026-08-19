import type { FastifyInstance } from 'fastify';

import { FeishuEventService } from '../feishu/feishu-event-service.js';

export function registerFeishuEventRoute(
  app: FastifyInstance,
  eventService: FeishuEventService,
): void {
  app.post('/events', async (request) => {
    const result = await eventService.handle(request.body);
    if (result.type === 'challenge') return { challenge: result.challenge };
    return {
      code: 0,
      processed: result.processed,
      ...(result.reminder ? { reminder: result.reminder } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
    };
  });
}
