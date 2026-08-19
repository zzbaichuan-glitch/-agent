import { createHash, timingSafeEqual } from 'node:crypto';

import { AssetService, ReminderService, type Reminder } from '@infomemory/core';

type UnknownRecord = Record<string, unknown>;

export type FeishuEventResult =
  | { type: 'challenge'; challenge: string }
  | {
    type: 'ack';
    processed: boolean;
    reminder?: Reminder | null;
    reason?:
      | 'unsupported_event'
      | 'unsupported_message_type'
      | 'invalid_event_payload'
      | 'duplicate_event'
      | 'duplicate_content';
  };

export class FeishuVerificationError extends Error {
  constructor() {
    super('Feishu callback verification failed');
    this.name = 'FeishuVerificationError';
  }
}

export class FeishuConfigurationError extends Error {
  constructor() {
    super('Feishu callback is not configured');
    this.name = 'FeishuConfigurationError';
  }
}

export class FeishuEventService {
  constructor(
    private readonly assetService: AssetService,
    private readonly reminderService: ReminderService,
    private readonly verificationToken?: string,
  ) {}

  async handle(payload: unknown): Promise<FeishuEventResult> {
    if (!this.verificationToken) throw new FeishuConfigurationError();
    const body = asRecord(payload);
    if (!body) return { type: 'ack', processed: false, reason: 'invalid_event_payload' };

    if (body.type === 'url_verification') {
      this.#verify(stringValue(body.token));
      const challenge = stringValue(body.challenge);
      if (!challenge) {
        return { type: 'ack', processed: false, reason: 'invalid_event_payload' };
      }
      return { type: 'challenge', challenge };
    }

    const header = asRecord(body.header);
    this.#verify(stringValue(header?.token));
    if (stringValue(header?.event_type) !== 'im.message.receive_v1') {
      return { type: 'ack', processed: false, reason: 'unsupported_event' };
    }

    const event = asRecord(body.event);
    const message = asRecord(event?.message);
    if (stringValue(message?.message_type) !== 'text') {
      return { type: 'ack', processed: false, reason: 'unsupported_message_type' };
    }

    const eventId = stringValue(header?.event_id);
    const tenantId = stringValue(header?.tenant_key);
    const sender = asRecord(event?.sender);
    const senderId = asRecord(sender?.sender_id);
    const userId = stringValue(senderId?.open_id)
      ?? stringValue(senderId?.union_id)
      ?? stringValue(senderId?.user_id);
    const messageId = stringValue(message?.message_id);
    const text = parseTextContent(stringValue(message?.content));
    if (!eventId || !tenantId || !userId || !messageId || !text) {
      return { type: 'ack', processed: false, reason: 'invalid_event_payload' };
    }

    const result = await this.assetService.ingest(
      { tenantId, userId },
      {
        title: `飞书消息：${singleLine(text).slice(0, 80)}`,
        content: text,
        idempotencyKey: `feishu-event:${eventId}`,
        visibility: 'owner',
        source: { type: 'feishu_message', externalId: messageId },
      },
    );

    const reminder = await this.reminderService.observeMessage(
      { tenantId, userId },
      { text, sourceAssetId: result.asset.id, sourceEventId: eventId },
    );
    if (result.created) return { type: 'ack', processed: true, reminder };
    return {
      type: 'ack',
      processed: false,
      reminder,
      reason: result.deduplicatedBy === 'idempotency'
        ? 'duplicate_event'
        : 'duplicate_content',
    };
  }

  #verify(receivedToken: string | null): void {
    if (!receivedToken || !safeEqual(receivedToken, this.verificationToken ?? '')) {
      throw new FeishuVerificationError();
    }
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseTextContent(content: string | null): string | null {
  if (!content) return null;
  try {
    const parsed = asRecord(JSON.parse(content));
    return stringValue(parsed?.text);
  } catch {
    return null;
  }
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
