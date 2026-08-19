import {
  AnswerService,
  AssetService,
  SearchService,
  SqliteAssetRepository,
  type LlmAnswerGenerator,
} from '@infomemory/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import {
  FeishuConfigurationError,
  FeishuEventService,
  FeishuVerificationError,
} from './feishu/feishu-event-service.js';
import { accessContextPlugin } from './plugins/access-context.js';
import { registerAnswerRoute } from './routes/answers.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerFeishuEventRoute } from './routes/feishu-events.js';
import { registerHealthRoute } from './routes/health.js';
import { registerSearchRoute } from './routes/search.js';

export interface BuildAppOptions {
  databasePath?: string;
  logger?: boolean;
  llmGenerator?: LlmAnswerGenerator;
  llmEnabled?: boolean;
  feishuVerificationToken?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const repository = new SqliteAssetRepository(options.databasePath ?? ':memory:');
  const assetService = new AssetService(repository);
  const searchService = new SearchService(repository);
  const answerService = new AnswerService(searchService, options.llmGenerator);
  const feishuEvents = new FeishuEventService(
    assetService,
    options.feishuVerificationToken,
  );

  app.addHook('onClose', async () => repository.close());
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Request validation failed',
      });
    }
    if (error instanceof FeishuVerificationError) {
      return reply.code(401).send({
        error: 'feishu_verification_failed',
        message: 'Feishu callback verification failed',
      });
    }
    if (error instanceof FeishuConfigurationError) {
      return reply.code(503).send({
        error: 'feishu_not_configured',
        message: 'Feishu callback is not configured',
      });
    }

    request.log.error({
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : 'Unknown failure',
      requestId: request.id,
    }, 'request failed');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'The request could not be completed',
      requestId: request.id,
    });
  });

  registerHealthRoute(app, {
    llmEnabled: options.llmEnabled ?? Boolean(options.llmGenerator),
    feishuConfigured: Boolean(options.feishuVerificationToken),
  });

  await app.register(async (secured) => {
    await accessContextPlugin(secured);
    registerAssetRoutes(secured, assetService, repository);
    registerSearchRoute(secured, searchService);
    registerAnswerRoute(secured, answerService);
  }, { prefix: '/v1' });

  await app.register(async (feishu) => {
    registerFeishuEventRoute(feishu, feishuEvents);
  }, { prefix: '/v1/connectors/feishu' });

  return app;
}
