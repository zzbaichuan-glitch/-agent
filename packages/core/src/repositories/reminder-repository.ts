import type {
  AccessContext,
  Reminder,
  ReminderPrecision,
  ReminderStatus,
} from '../domain.js';

export interface PersistReminderInput {
  id: string;
  context: AccessContext;
  title: string;
  startsAt: string;
  remindAt: string;
  status: ReminderStatus;
  precision: ReminderPrecision;
  sourceAssetId?: string;
  sourceEventId?: string;
  createdAt: string;
}

export interface ReminderListOptions {
  limit?: number;
  offset?: number;
  status?: ReminderStatus | ReminderStatus[];
  dueBefore?: string;
}

export interface ReminderRepository {
  createReminder(input: PersistReminderInput): Promise<Reminder>;
  findReminderBySourceEvent(
    context: AccessContext,
    sourceEventId: string,
  ): Promise<Reminder | null>;
  findReminder(context: AccessContext, id: string): Promise<Reminder | null>;
  listReminders(
    context: AccessContext,
    options?: ReminderListOptions,
  ): Promise<Reminder[]>;
  updateReminderStatus(
    context: AccessContext,
    id: string,
    status: ReminderStatus,
  ): Promise<Reminder | null>;
}
