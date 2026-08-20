import {
  AnswerService,
  AssetService,
  SearchService,
  ReminderService,
  ReminderNotificationWorker,
  type ReminderNotifier,
  SqliteAssetRepository,
  type LlmAnswerGenerator,
} from '@infomemory/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import {
  FeishuConfigurationError,
  FeishuEventService,
  FeishuPayloadError,
  FeishuVerificationError,
} from './feishu/feishu-event-service.js';
import type { FeishuMessenger } from './feishu/feishu-client.js';
import { accessContextPlugin } from './plugins/access-context.js';
import { registerAnswerRoute } from './routes/answers.js';
import { registerAssetRoutes } from './routes/assets.js';
import { registerFeishuEventRoute } from './routes/feishu-events.js';
import { registerHealthRoute } from './routes/health.js';
import { registerSearchRoute } from './routes/search.js';
import { registerReminderRoutes } from './routes/reminders.js';

export interface BuildAppOptions {
  databasePath?: string;
  logger?: boolean;
  llmGenerator?: LlmAnswerGenerator;
  llmEnabled?: boolean;
  feishuVerificationToken?: string;
  feishuEncryptKey?: string;
  feishuMessenger?: FeishuMessenger;
  reminderNotifier?: ReminderNotifier;
  reminderWorkerEnabled?: boolean;
  reminderPollIntervalMs?: number;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const repository = new SqliteAssetRepository(options.databasePath ?? ':memory:');
  const assetService = new AssetService(repository);
  const searchService = new SearchService(repository);
  const answerService = new AnswerService(searchService, options.llmGenerator);
  const reminderService = new ReminderService(repository);
  const reminderWorker = options.reminderWorkerEnabled && options.reminderNotifier
    ? new ReminderNotificationWorker(repository, options.reminderNotifier, {
      ...(options.reminderPollIntervalMs !== undefined
        ? { intervalMs: options.reminderPollIntervalMs }
        : {}),
      onError: (error) => app.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'reminder notification failed'),
    })
    : undefined;
  const feishuEvents = new FeishuEventService(
    assetService,
    reminderService,
    {
      ...(options.feishuVerificationToken
        ? { verificationToken: options.feishuVerificationToken }
        : {}),
      ...(options.feishuEncryptKey ? { encryptKey: options.feishuEncryptKey } : {}),
      ...(options.feishuMessenger ? { messenger: options.feishuMessenger } : {}),
    },
  );

  app.addHook('onClose', async () => {
    reminderWorker?.stop();
    repository.close();
  });
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
    if (error instanceof FeishuPayloadError) {
      return reply.code(400).send({
        error: 'feishu_payload_invalid',
        message: 'Feishu callback payload could not be decrypted',
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
    feishuNotificationsEnabled: Boolean(options.feishuMessenger),
  });

  await app.register(async (secured) => {
    await accessContextPlugin(secured);
    registerAssetRoutes(secured, assetService, repository);
    registerSearchRoute(secured, searchService);
    registerAnswerRoute(secured, answerService);
    registerReminderRoutes(secured, reminderService);
  }, { prefix: '/v1' });

  await app.register(async (feishu) => {
    registerFeishuEventRoute(feishu, feishuEvents);
  }, { prefix: '/v1/connectors/feishu' });

  reminderWorker?.start();

  return app;
}
