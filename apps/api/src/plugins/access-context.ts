import type { AccessContext } from '@infomemory/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    accessContext: AccessContext | null;
  }
}

export async function accessContextPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('accessContext', null);
  app.addHook('preHandler', async (request, reply) => {
    const tenantId = singleHeader(request, 'x-tenant-id');
    const userId = singleHeader(request, 'x-user-id');
    if (!tenantId || !userId) {
      await unauthorized(reply);
      return;
    }
    request.accessContext = { tenantId, userId };
  });
}

export function requireAccessContext(request: FastifyRequest): AccessContext {
  if (!request.accessContext) {
    throw new Error('Access context hook was not registered');
  }
  return request.accessContext;
}

function singleHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function unauthorized(reply: FastifyReply): Promise<void> {
  await reply.code(401).send({
    error: 'access_context_required',
    message: 'x-tenant-id and x-user-id headers are required',
  });
}
