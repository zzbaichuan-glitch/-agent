import { z } from 'zod';

const booleanValue = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false' || value === '') return false;
  return value;
}, z.boolean());

const optionalString = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  DATABASE_PATH: z.string().trim().min(1).default('./var/infomemory.sqlite'),
  LLM_ENABLED: booleanValue.default(false),
  LLM_BASE_URL: z.url().default('https://llm-gw.bupt.edu.cn/v1'),
  LLM_API_KEY: optionalString,
  LLM_MODEL: optionalString,
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1).max(120_000).default(15_000),
  FEISHU_VERIFICATION_TOKEN: optionalString,
  FEISHU_APP_ID: optionalString,
  FEISHU_APP_SECRET: optionalString,
  FEISHU_API_BASE_URL: z.url().default('https://open.feishu.cn'),
  FEISHU_API_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  FEISHU_ENCRYPT_KEY: optionalString,
  FEISHU_NOTIFICATIONS_ENABLED: booleanValue.default(false),
  REMINDER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(15_000),
}).superRefine((value, context) => {
  if (value.LLM_ENABLED) {
    if (!value.LLM_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'LLM_API_KEY is required when LLM_ENABLED=true',
      });
    }
    if (!value.LLM_MODEL) {
      context.addIssue({
        code: 'custom',
        path: ['LLM_MODEL'],
        message: 'LLM_MODEL is required when LLM_ENABLED=true',
      });
    }
  }
  if (value.FEISHU_NOTIFICATIONS_ENABLED) {
    if (!value.FEISHU_VERIFICATION_TOKEN) {
      context.addIssue({
        code: 'custom',
        path: ['FEISHU_VERIFICATION_TOKEN'],
        message: 'FEISHU_VERIFICATION_TOKEN is required when FEISHU_NOTIFICATIONS_ENABLED=true',
      });
    }
    if (!value.FEISHU_APP_ID) {
      context.addIssue({
        code: 'custom',
        path: ['FEISHU_APP_ID'],
        message: 'FEISHU_APP_ID is required when FEISHU_NOTIFICATIONS_ENABLED=true',
      });
    }
    if (!value.FEISHU_APP_SECRET) {
      context.addIssue({
        code: 'custom',
        path: ['FEISHU_APP_SECRET'],
        message: 'FEISHU_APP_SECRET is required when FEISHU_NOTIFICATIONS_ENABLED=true',
      });
    }
  }
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databasePath: string;
  llmEnabled: boolean;
  llmBaseUrl: string;
  llmApiKey?: string;
  llmModel?: string;
  llmTimeoutMs: number;
  feishuVerificationToken?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
  feishuApiBaseUrl: string;
  feishuApiTimeoutMs: number;
  feishuEncryptKey?: string;
  feishuNotificationsEnabled: boolean;
  reminderPollIntervalMs: number;
}

export function loadAppConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databasePath: parsed.DATABASE_PATH,
    llmEnabled: parsed.LLM_ENABLED,
    llmBaseUrl: parsed.LLM_BASE_URL,
    llmTimeoutMs: parsed.LLM_TIMEOUT_MS,
    ...(parsed.LLM_API_KEY ? { llmApiKey: parsed.LLM_API_KEY } : {}),
    ...(parsed.LLM_MODEL ? { llmModel: parsed.LLM_MODEL } : {}),
    ...(parsed.FEISHU_VERIFICATION_TOKEN
      ? { feishuVerificationToken: parsed.FEISHU_VERIFICATION_TOKEN }
      : {}),
    ...(parsed.FEISHU_APP_ID ? { feishuAppId: parsed.FEISHU_APP_ID } : {}),
    ...(parsed.FEISHU_APP_SECRET
      ? { feishuAppSecret: parsed.FEISHU_APP_SECRET }
      : {}),
    feishuApiBaseUrl: parsed.FEISHU_API_BASE_URL,
    feishuApiTimeoutMs: parsed.FEISHU_API_TIMEOUT_MS,
    feishuNotificationsEnabled: parsed.FEISHU_NOTIFICATIONS_ENABLED,
    reminderPollIntervalMs: parsed.REMINDER_POLL_INTERVAL_MS,
    ...(parsed.FEISHU_ENCRYPT_KEY ? { feishuEncryptKey: parsed.FEISHU_ENCRYPT_KEY } : {}),
  };
}
