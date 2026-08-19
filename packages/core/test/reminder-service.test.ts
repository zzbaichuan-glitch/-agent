import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SqliteAssetRepository } from '../src/repositories/sqlite-asset-repository.js';
import { extractMeetingReminder } from '../src/services/meeting-time-extractor.js';
import { ReminderService } from '../src/services/reminder-service.js';

const context = { tenantId: 'tenant-a', userId: 'alice' };
const now = new Date('2026-08-19T02:00:00.000Z');

describe('meeting reminder extraction', () => {
  it('extracts an exact Chinese date and time', () => {
    const result = extractMeetingReminder('请注意，明天 14:30 开会讨论上线方案。', now);

    expect(result).toMatchObject({
      precision: 'exact',
      needsConfirmation: false,
      startsAt: new Date('2026-08-20T06:30:00.000Z'),
    });
  });

  it('extracts an absolute date and treats an hour-only time as exact', () => {
    const result = extractMeetingReminder('2026年8月20日 14点开会。', now);

    expect(result).toMatchObject({
      precision: 'exact',
      needsConfirmation: false,
      startsAt: new Date('2026-08-20T06:00:00.000Z'),
    });
  });

  it('marks broad periods as needing confirmation', () => {
    const result = extractMeetingReminder('下午要开会，大家别忘了参加。', now);

    expect(result).toMatchObject({
      precision: 'period',
      needsConfirmation: true,
      startsAt: new Date('2026-08-19T07:00:00.000Z'),
    });
  });

  it('ignores ordinary messages without meeting time signals', () => {
    expect(extractMeetingReminder('今天请查收项目周报。', now)).toBeNull();
  });
});

describe('ReminderService', () => {
  let repository: SqliteAssetRepository;
  let service: ReminderService;
  let idCounter: number;

  beforeEach(() => {
    repository = new SqliteAssetRepository(':memory:');
    idCounter = 0;
    service = new ReminderService(repository, {
      now: () => now,
      idFactory: () => `reminder-${++idCounter}`,
    });
  });

  afterEach(() => repository.close());

  it('creates a private reminder and deduplicates the source event', async () => {
    const first = await service.observeMessage(context, {
      text: '明天 14:30 开会讨论上线方案。',
      sourceEventId: 'event-1',
    });
    const second = await service.observeMessage(context, {
      text: '明天 14:30 开会讨论上线方案。',
      sourceEventId: 'event-1',
    });

    expect(first?.status).toBe('scheduled');
    expect(second?.id).toBe(first?.id);
    await expect(service.list({ tenantId: 'tenant-b', userId: 'bob' })).resolves.toEqual([]);
  });

  it('supports confirmation and completion status transitions', async () => {
    const reminder = await service.observeMessage(context, {
      text: '下午要开会。',
      sourceEventId: 'event-2',
    });
    expect(reminder?.status).toBe('needs_confirmation');

    const confirmed = await service.updateStatus(context, reminder?.id ?? '', 'scheduled');
    const completed = await service.updateStatus(context, reminder?.id ?? '', 'completed');
    expect(confirmed?.status).toBe('scheduled');
    expect(completed?.status).toBe('completed');
  });

  it('only exposes confirmed scheduled reminders as due', async () => {
    const pending = await service.observeMessage(context, {
      text: '下午要开会。',
      sourceEventId: 'event-pending',
    });
    const exact = await service.observeMessage(context, {
      text: '今天 09:30 开会。',
      sourceEventId: 'event-exact',
    });

    expect(pending?.status).toBe('needs_confirmation');
    expect(exact?.status).toBe('scheduled');
    const due = await service.listDue(context, new Date('2026-08-19T08:00:00.000Z'));
    expect(due).toHaveLength(1);
    expect(due.every((item) => item.status === 'scheduled')).toBe(true);
  });
});
