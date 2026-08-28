import type { ReminderWindow } from '../persistence/persistence-domain';

export const reminderAuthorizations = [
  'notDetermined',
  'denied',
  'authorized',
  'provisional',
  'unavailable',
] as const;

export type ReminderAuthorization = (typeof reminderAuthorizations)[number];

export type ReminderServiceError = Readonly<{
  code: 'unavailable' | 'schedulingFailed' | 'cancellationFailed';
}>;

export type ReminderResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: ReminderServiceError }>;

export interface ReminderScheduling {
  authorizationStatus(): Promise<ReminderResult<ReminderAuthorization>>;
  requestAuthorization(): Promise<ReminderResult<ReminderAuthorization>>;
  replaceDailyReminder(
    window: ReminderWindow,
    timeZoneId: string,
  ): Promise<ReminderResult<void>>;
  cancelAll(): Promise<ReminderResult<void>>;
}
