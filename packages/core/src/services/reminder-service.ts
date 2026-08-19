import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { AccessContext, Reminder, ReminderStatus } from '../domain.js';
import type { ReminderRepository } from '../repositories/reminder-repository.js';
import { extractMeetingReminder, type MeetingReminderCandidate } from './meeting-time-extractor.js';

const accessContextSchema = z.object({
  tenantId: z.string().trim().min(1).max(200),
  userId: z.string().trim().min(1).max(200),
});

const listSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(100_000).default(0),
  status: z.union([
    z.enum(['scheduled', 'needs_confirmation', 'completed', 'cancelled']),
    z.array(z.enum(['scheduled', 'needs_confirmation', 'completed', 'cancelled'])).min(1),
  ]).optional(),
  dueBefore: z.iso.datetime().optional(),
});

export interface ReminderObservation {
  text: string;
  sourceAssetId?: string;
  sourceEventId?: string;
}

export interface ReminderServiceOptions {
  idFactory?: () => string;
  now?: () => Date;
}

export class ReminderService {
  readonly #idFactory: () => string;
  readonly #now: () => Date;

  constructor(
    private readonly repository: ReminderRepository,
    options: ReminderServiceOptions = {},
  ) {
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async observeMessage(
    contextInput: AccessContext,
    observation: ReminderObservation,
  ): Promise<Reminder | null> {
    const context = accessContextSchema.parse(contextInput);
    const text = z.string().trim().min(1).max(1_000_000).parse(observation.text);
    if (observation.sourceEventId) {
      const existing = await this.repository.findReminderBySourceEvent(
        context,
        observation.sourceEventId,
      );
      if (existing) return existing;
    }
    const candidate = extractMeetingReminder(text, this.#now());
    if (!candidate) return null;
    return this.#persistCandidate(context, candidate, observation);
  }

  async list(
    contextInput: AccessContext,
    input: {
      limit?: number;
      offset?: number;
      status?: ReminderStatus | ReminderStatus[];
      dueBefore?: string;
    } = {},
  ): Promise<Reminder[]> {
    const context = accessContextSchema.parse(contextInput);
    const options = listSchema.parse(input);
    return this.repository.listReminders(context, {
      limit: options.limit,
      offset: options.offset,
      ...(options.status !== undefined ? { status: options.status } : {}),
      ...(options.dueBefore !== undefined ? { dueBefore: options.dueBefore } : {}),
    });
  }

  async listDue(contextInput: AccessContext, at = this.#now()): Promise<Reminder[]> {
    const context = accessContextSchema.parse(contextInput);
    return this.repository.listReminders(context, {
      status: 'scheduled',
      dueBefore: at.toISOString(),
      limit: 200,
    });
  }

  async updateStatus(
    contextInput: AccessContext,
    idInput: string,
    status: ReminderStatus,
  ): Promise<Reminder | null> {
    const context = accessContextSchema.parse(contextInput);
    const id = z.string().trim().min(1).max(200).parse(idInput);
    const nextStatus = z.enum(['scheduled', 'needs_confirmation', 'completed', 'cancelled']).parse(status);
    return this.repository.updateReminderStatus(context, id, nextStatus);
  }

  #persistCandidate(
    context: AccessContext,
    candidate: MeetingReminderCandidate,
    observation: ReminderObservation,
  ): Promise<Reminder> {
    return this.repository.createReminder({
      id: this.#idFactory(),
      context,
      title: candidate.title,
      startsAt: candidate.startsAt.toISOString(),
      remindAt: candidate.remindAt.toISOString(),
      status: candidate.needsConfirmation ? 'needs_confirmation' : 'scheduled',
      precision: candidate.precision,
      ...(observation.sourceAssetId ? { sourceAssetId: observation.sourceAssetId } : {}),
      ...(observation.sourceEventId ? { sourceEventId: observation.sourceEventId } : {}),
      createdAt: this.#now().toISOString(),
    });
  }
}
